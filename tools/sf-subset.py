#!/usr/bin/env python3
"""Cut a SoundFont (SF2, or SF3 with Ogg Vorbis compressed samples) down to some of its presets.

    tools/sf-subset.py list  <soundfont>                         the presets, with what each needs on its own
    tools/sf-subset.py keep  <soundfont> <out> <bank:program>...  a soundfont with only those presets
    tools/sf-subset.py split <soundfont> <directory>             one soundfont per preset, and index.json

A page loads only the sounds a song uses: Sf2Player gets a soundfont holding just those presets,
the instruments they use and the samples those use. Everything is copied as it is (an SF3's
compressed samples byte for byte, generators and modulators in their order), so a synthesizer
plays a preset from the cut soundfont exactly as from the whole one; bank and program numbers
stay, so a project's bank and patch still name it. The INFO list is kept.

split writes <directory>/<bank>-<program>.<sf2|sf3> for every preset and index.json:
[{"bank", "program", "name", "file", "bytes", "sha256"}], drum kits on bank 128.

Python 3.8+, standard library only. Part of lmms-web (https://github.com/MildyNora/lmms-web),
GPL-2.0-or-later.
"""
import hashlib
import json
import os
import struct
import sys

PHDR, PBAG, PMOD, PGEN = struct.Struct("<20sHHHIII"), struct.Struct("<HH"), 10, struct.Struct("<HH")
INST, IBAG, IMOD, IGEN = struct.Struct("<20sH"), struct.Struct("<HH"), 10, struct.Struct("<HH")
SHDR = struct.Struct("<20sIIIIIBbHH")
GEN_INSTRUMENT, GEN_SAMPLE = 41, 53
COMPRESSED = 0x10       # sfSampleType: Ogg Vorbis (SF3); start and end are byte offsets in smpl,
                        # loop points relative to the decompressed sample
ROM = 0x8000
PAD_FRAMES = 46         # zero frames after each uncompressed sample (the SoundFont 2 specification)


def chunks(data, start, end):
    at = start
    while at + 8 <= end:
        cid = data[at:at + 4]
        size = struct.unpack_from("<I", data, at + 4)[0]
        yield cid, at + 8, min(at + 8 + size, end)
        at += 8 + size + (size & 1)


def records(blob, rec):
    size = rec if isinstance(rec, int) else rec.size
    return [blob[i:i + size] for i in range(0, len(blob) - size + 1, size)]


class SoundFont:
    def __init__(self, path):
        data = open(path, "rb").read()
        if data[0:4] != b"RIFF" or data[8:12] != b"sfbk":
            raise ValueError(f"{path} isn't a SoundFont (no RIFF sfbk header)")
        lists = {}
        for cid, a, b in chunks(data, 12, len(data)):
            if cid == b"LIST":
                lists[data[a:a + 4]] = (a + 4, b)
        for need in (b"INFO", b"sdta", b"pdta"):
            if need not in lists:
                raise ValueError(f"{path} has no {need.decode()} list")
        self.info = [(cid, data[a:b]) for cid, a, b in chunks(data, *lists[b"INFO"])]
        sdta = {cid: data[a:b] for cid, a, b in chunks(data, *lists[b"sdta"])}
        self.smpl, self.sm24 = sdta.get(b"smpl", b""), sdta.get(b"sm24")
        pdta = {cid: data[a:b] for cid, a, b in chunks(data, *lists[b"pdta"])}
        self.phdr = [PHDR.unpack(r) for r in records(pdta[b"phdr"], PHDR)]
        self.pbag = [PBAG.unpack(r) for r in records(pdta[b"pbag"], PBAG)]
        self.pmod = records(pdta[b"pmod"], PMOD)
        self.pgen = [PGEN.unpack(r) for r in records(pdta[b"pgen"], PGEN)]
        self.inst = [INST.unpack(r) for r in records(pdta[b"inst"], INST)]
        self.ibag = [IBAG.unpack(r) for r in records(pdta[b"ibag"], IBAG)]
        self.imod = records(pdta[b"imod"], IMOD)
        self.igen = [IGEN.unpack(r) for r in records(pdta[b"igen"], IGEN)]
        self.shdr = [SHDR.unpack(r) for r in records(pdta[b"shdr"], SHDR)]
        self.compressed = any(s[9] & COMPRESSED for s in self.shdr[:-1])

    def presets(self):
        """[(index, bank, program, name)] without the terminal record."""
        return [(i, p[2], p[1], p[0].split(b"\0")[0].decode("latin-1").strip()) for i, p in enumerate(self.phdr[:-1])]

    def find(self, bank, program):
        for i, b, p, _ in self.presets():
            if b == bank and p == program:
                return i
        raise KeyError(f"no preset at bank {bank}, program {program}")

    def needs(self, presets):
        """(instruments, samples) the presets use, as sorted indices (linked stereo partners included)."""
        insts, samples = set(), set()
        for i in presets:
            for b in range(self.phdr[i][3], self.phdr[i + 1][3]):
                for g in range(self.pbag[b][0], self.pbag[b + 1][0]):
                    if self.pgen[g][0] == GEN_INSTRUMENT:
                        insts.add(self.pgen[g][1])
        for j in insts:
            for b in range(self.inst[j][1], self.inst[j + 1][1]):
                for g in range(self.ibag[b][0], self.ibag[b + 1][0]):
                    if self.igen[g][0] == GEN_SAMPLE:
                        samples.add(self.igen[g][1])
        for s in list(samples):
            kind, link = self.shdr[s][9], self.shdr[s][8]
            if kind & 0x0E and not kind & ROM and 0 <= link < len(self.shdr) - 1:
                samples.add(link)
        return sorted(insts), sorted(samples)

    def sample_bytes(self, s):
        name, start, end = self.shdr[s][0], self.shdr[s][1], self.shdr[s][2]
        if self.shdr[s][9] & COMPRESSED:
            return end - start
        return 2 * (end - start + PAD_FRAMES) + (end - start + PAD_FRAMES if self.sm24 else 0)

    def subset(self, presets):
        """The bytes of a soundfont holding only these presets (indices into phdr), in their original order."""
        presets = sorted(set(presets))
        insts, samples = self.needs(presets)
        inst_at = {j: k for k, j in enumerate(insts)}
        sample_at = {s: k for k, s in enumerate(samples)}

        # samples: the data each needs, copied as it is, and its header pointing at the copy
        smpl, sm24, shdr = bytearray(), bytearray(), []
        for s in samples:
            name, start, end, lstart, lend, rate, pitch, corr, link, kind = self.shdr[s]
            new_link = sample_at.get(link, 0)
            if kind & ROM:
                shdr.append(SHDR.pack(name, start, end, lstart, lend, rate, pitch, corr, new_link, kind))
                continue
            if kind & COMPRESSED:
                at = len(smpl)
                smpl += self.smpl[start:end]
                shdr.append(SHDR.pack(name, at, at + (end - start), lstart, lend, rate, pitch, corr, new_link, kind))
            else:
                at = len(smpl) // 2
                smpl += self.smpl[2 * start:2 * end] + bytes(2 * PAD_FRAMES)
                if self.sm24 is not None:
                    sm24 += self.sm24[start:end] + bytes(PAD_FRAMES)
                shift = at - start
                shdr.append(SHDR.pack(name, at, at + (end - start), lstart + shift, lend + shift, rate, pitch, corr, new_link, kind))
        shdr.append(SHDR.pack(b"EOS", 0, 0, 0, 0, 0, 0, 0, 0, 0))

        # instruments, their zones (bags), generators (sample numbers remapped) and modulators
        inst, ibag, imod, igen = [], [], [], []
        for j in insts:
            inst.append(INST.pack(self.inst[j][0], len(ibag)))
            for b in range(self.inst[j][1], self.inst[j + 1][1]):
                ibag.append(IBAG.pack(len(igen), len(imod)))
                for g in range(self.ibag[b][0], self.ibag[b + 1][0]):
                    oper, amount = self.igen[g]
                    igen.append(IGEN.pack(oper, sample_at[amount] if oper == GEN_SAMPLE else amount))
                imod.extend(self.imod[self.ibag[b][1]:self.ibag[b + 1][1]])
        inst.append(INST.pack(b"EOI", len(ibag)))
        ibag.append(IBAG.pack(len(igen), len(imod)))
        imod.append(bytes(IMOD))
        igen.append(IGEN.pack(0, 0))

        # presets, likewise (instrument numbers remapped)
        phdr, pbag, pmod, pgen = [], [], [], []
        for i in presets:
            name, program, bank, _, library, genre, morphology = self.phdr[i]
            phdr.append(PHDR.pack(name, program, bank, len(pbag), library, genre, morphology))
            for b in range(self.phdr[i][3], self.phdr[i + 1][3]):
                pbag.append(PBAG.pack(len(pgen), len(pmod)))
                for g in range(self.pbag[b][0], self.pbag[b + 1][0]):
                    oper, amount = self.pgen[g]
                    pgen.append(PGEN.pack(oper, inst_at[amount] if oper == GEN_INSTRUMENT else amount))
                pmod.extend(self.pmod[self.pbag[b][1]:self.pbag[b + 1][1]])
        phdr.append(PHDR.pack(b"EOP", 0, 0, len(pbag), 0, 0, 0))
        pbag.append(PBAG.pack(len(pgen), len(pmod)))
        pmod.append(bytes(PMOD))
        pgen.append(PGEN.pack(0, 0))

        sdta = [chunk(b"smpl", bytes(smpl))] + ([chunk(b"sm24", bytes(sm24))] if self.sm24 is not None and not self.compressed else [])
        pdta = [chunk(b"phdr", b"".join(phdr)), chunk(b"pbag", b"".join(pbag)), chunk(b"pmod", b"".join(pmod)),
                chunk(b"pgen", b"".join(pgen)), chunk(b"inst", b"".join(inst)), chunk(b"ibag", b"".join(ibag)),
                chunk(b"imod", b"".join(imod)), chunk(b"igen", b"".join(igen)), chunk(b"shdr", b"".join(shdr))]
        body = b"sfbk" + riff_list(b"INFO", [chunk(cid, payload) for cid, payload in self.info]) \
            + riff_list(b"sdta", sdta) + riff_list(b"pdta", pdta)
        return b"RIFF" + struct.pack("<I", len(body)) + body


def chunk(cid, payload):
    return cid + struct.pack("<I", len(payload)) + payload + (b"\0" if len(payload) & 1 else b"")


def riff_list(kind, parts):
    return chunk(b"LIST", kind + b"".join(parts))


def bank_program(arg):
    bank, _, program = arg.partition(":")
    return int(bank), int(program)


def main(argv):
    if len(argv) < 2 or argv[0] not in ("list", "keep", "split"):
        print(__doc__.strip().split("\n\n")[0], file=sys.stderr)
        return 2
    sf = SoundFont(argv[1])
    ext = ".sf3" if sf.compressed else ".sf2"
    if argv[0] == "list":
        for i, bank, program, name in sf.presets():
            _, samples = sf.needs([i])
            print(f"{bank:3d}:{program:<3d}  {sum(sf.sample_bytes(s) for s in samples) / 1e6:7.2f} MB  {name}")
        return 0
    if argv[0] == "keep":
        if len(argv) < 4:
            print("keep needs an output file and at least one bank:program", file=sys.stderr)
            return 2
        out = sf.subset([sf.find(*bank_program(a)) for a in argv[3:]])
        with open(argv[2], "wb") as f:
            f.write(out)
        print(f"{argv[2]}: {len(argv) - 3} presets, {len(out) / 1e6:.2f} MB")
        return 0
    os.makedirs(argv[2], exist_ok=True)
    index = []
    for i, bank, program, name in sf.presets():
        out = sf.subset([i])
        file = f"{bank}-{program}{ext}"
        with open(os.path.join(argv[2], file), "wb") as f:
            f.write(out)
        index.append({"bank": bank, "program": program, "name": name, "file": file, "bytes": len(out),
                      "sha256": hashlib.sha256(out).hexdigest()})
    with open(os.path.join(argv[2], "index.json"), "w") as f:
        json.dump(index, f, indent=1)
    print(f"{argv[2]}: {len(index)} presets, {sum(x['bytes'] for x in index) / 1e6:.1f} MB in all")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

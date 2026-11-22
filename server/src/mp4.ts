// Reading an MP4 (or QuickTime .mov) file's boxes, to tell whether browsers can play it before
// anyone sits down to watch. Peiskos doesn't convert videos, so a movie has to arrive as H.264
// video with AAC (or no) sound, the one mix every browser and phone plays.
import { open } from 'node:fs/promises';

export type Mp4Info = { duration: number; width: number; height: number };

/** Why a file can't be a movie, in words for the person who sent it. */
export class Mp4Problem extends Error {}

export const CONVERT = 'Convert it to MP4 with H.264 video and AAC sound (HandBrake\'s "Fast 1080p30" does this), then try again.';
// The moov box (the index of every frame) is a few MB for a long movie; past this it isn't one.
const MAX_MOOV = 128 * 1024 * 1024;
// 10-bit and 4:2:2/4:4:4 H.264 profiles: browsers only play 8-bit 4:2:0 (High and below).
const UNPLAYABLE_PROFILES: Record<number, string> = { 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };

type Box = { type: string; start: number; end: number }; // start of its contents, end of the box

/** The boxes inside buf[from..to), in order. */
function boxes(buf: Buffer, from = 0, to = buf.length): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}
const child = (buf: Buffer, box: Box | undefined, type: string) => (box ? boxes(buf, box.start, box.end).find((b) => b.type === type) : undefined);
const path = (buf: Buffer, box: Box | undefined, ...types: string[]) => types.reduce<Box | undefined>((b, t) => child(buf, b, t), box);

/** A track's kind and first sample description: 'vide' / 'soun' and a codec like 'avc1' or 'mp4a'. */
function track(buf: Buffer, trak: Box) {
  const mdia = child(buf, trak, 'mdia');
  const hdlr = child(buf, mdia, 'hdlr');
  const kind = hdlr && hdlr.end - hdlr.start >= 12 ? buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) : '';
  const stsd = path(buf, mdia, 'minf', 'stbl', 'stsd');
  // stsd: version+flags (4), entry count (4), then the sample entries as boxes.
  const entry = stsd ? boxes(buf, stsd.start + 8, stsd.end)[0] : undefined;
  let profile: number | null = null;
  if (entry && (entry.type === 'avc1' || entry.type === 'avc3')) {
    // A visual sample entry has 78 bytes of fields before its own boxes; avcC's second byte is the profile.
    const avcC = boxes(buf, entry.start + 78, entry.end).find((b) => b.type === 'avcC');
    if (avcC && avcC.end - avcC.start >= 2) profile = buf[avcC.start + 1];
  }
  const tkhd = child(buf, trak, 'tkhd');
  // tkhd ends with the width and height as 16.16 fixed point numbers.
  const width = tkhd ? buf.readUInt32BE(tkhd.end - 8) / 65536 : 0;
  const height = tkhd ? buf.readUInt32BE(tkhd.end - 4) / 65536 : 0;
  return { kind, codec: entry?.type ?? '', profile, width: Math.round(width), height: Math.round(height) };
}

const CODEC_NAMES: Record<string, string> = {
  hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', av01: 'AV1', vp09: 'VP9', mp4v: 'MPEG-4 Part 2', 'ac-3': 'Dolby Digital (AC-3)',
  'ec-3': 'Dolby Digital Plus (E-AC-3)', dtsc: 'DTS', alac: 'Apple Lossless', Opus: 'Opus', fLaC: 'FLAC', lpcm: 'PCM', sowt: 'PCM', twos: 'PCM',
};
const codecName = (c: string) => CODEC_NAMES[c] ?? (c.trim() || 'an unknown kind');

/** Checks a file on disk is an MP4 that browsers play, and reads how long and how big it is. */
export async function inspectMp4(file: string): Promise<Mp4Info> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const read = async (at: number, length: number) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, at);
      return buf.subarray(0, bytesRead);
    };
    // Walks the top-level boxes by their headers alone, so the movie itself is never read.
    let at = 0, sawFtyp = false, moov: Buffer | null = null;
    while (at + 8 <= size) {
      const head = await read(at, 16);
      if (head.length < 8) break;
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let header = 8;
      if (boxSize === 1) {
        if (head.length < 16) break;
        boxSize = Number(head.readBigUInt64BE(8));
        header = 16;
      } else if (boxSize === 0) boxSize = size - at;
      if (at === 0 && type !== 'ftyp') throw new Mp4Problem(`That isn't an MP4 file. ${CONVERT}`);
      if (boxSize < header || at + boxSize > size) {
        if (!moov) throw new Mp4Problem(`That file is cut short or damaged. ${CONVERT}`);
        break;
      }
      if (type === 'ftyp') sawFtyp = true;
      if (type === 'moov') {
        if (boxSize > MAX_MOOV) throw new Mp4Problem(`That file is damaged. ${CONVERT}`);
        moov = await read(at + header, boxSize - header);
      }
      at += boxSize;
    }
    if (!sawFtyp) throw new Mp4Problem(`That isn't an MP4 file. ${CONVERT}`);
    if (!moov) throw new Mp4Problem(`That file is cut short or damaged. ${CONVERT}`);

    const top: Box = { type: 'moov', start: 0, end: moov.length };
    const mvhd = child(moov, top, 'mvhd');
    let duration = 0;
    if (mvhd) {
      const v1 = moov[mvhd.start] === 1;
      const scale = moov.readUInt32BE(mvhd.start + (v1 ? 20 : 12));
      const length = v1 ? Number(moov.readBigUInt64BE(mvhd.start + 24)) : moov.readUInt32BE(mvhd.start + 16);
      if (scale) duration = length / scale;
      // A fragmented MP4 (as some recorders and converters write) keeps its length in mvex/mehd.
      const mehd = path(moov, top, 'mvex', 'mehd');
      if (!duration && mehd && scale) duration = (moov[mehd.start] === 1 ? Number(moov.readBigUInt64BE(mehd.start + 4)) : moov.readUInt32BE(mehd.start + 4)) / scale;
    }
    const tracks = boxes(moov).filter((b) => b.type === 'trak').map((t) => track(moov!, t));
    const video = tracks.filter((t) => t.kind === 'vide');
    const audio = tracks.filter((t) => t.kind === 'soun');
    if (tracks.some((t) => t.codec === 'encv' || t.codec === 'enca')) throw new Mp4Problem('That movie is copy-protected, so it can\'t be played here.');
    if (!video.length) throw new Mp4Problem('That file has no video in it.');
    const v = video[0];
    if (v.codec !== 'avc1' && v.codec !== 'avc3') throw new Mp4Problem(`That movie's video is ${codecName(v.codec)}, which some browsers can't play. ${CONVERT}`);
    if (v.profile !== null && UNPLAYABLE_PROFILES[v.profile]) throw new Mp4Problem(`That movie's video is H.264 ${UNPLAYABLE_PROFILES[v.profile]}, which browsers can't play. ${CONVERT}`);
    const badSound = audio.find((a) => a.codec !== 'mp4a');
    if (badSound) throw new Mp4Problem(`That movie's sound is ${codecName(badSound.codec)}, which browsers can't play. ${CONVERT}`);
    if (!(duration > 0)) {
      // Written in fragments without saying the total length: players can't skip around in it.
      if (path(moov, top, 'mvex')) throw new Mp4Problem(`That MP4 is written in fragments without its length, so players can't skip around in it. ${CONVERT}`);
      throw new Mp4Problem(`That file doesn't say how long it is, so it may be damaged. ${CONVERT}`);
    }
    return { duration: Math.round(duration * 10) / 10, width: v.width, height: v.height };
  } finally {
    await fh.close();
  }
}

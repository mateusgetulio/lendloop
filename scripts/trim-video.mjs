import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";
assert.equal(process.version, "v22.22.0");
const [manifest, output] = process.argv.slice(2);
assert(manifest && output, "Pass a segment manifest and output filename.");
const segments = JSON.parse(readFileSync(manifest, "utf8"));
assert(
  segments.length &&
    segments.reduce((sum, part) => sum + part.duration, 0) < 90,
  "Recording exceeds 90 seconds. Trim the scenes before publishing.",
);
const work = dirname(manifest);
function run(file, args) {
  return execFileSync(file, args, { encoding: "utf8", stdio: "pipe" });
}
const clips = segments.map((part, index) => {
  const clip = join(work, `trimmed-${index}.mp4`);
  run("ffmpeg", [
    "-y",
    "-ss",
    String(part.start),
    "-i",
    part.path,
    "-t",
    String(part.duration),
    "-an",
    "-vf",
    "fps=20,scale=1280:720",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "29",
    "-pix_fmt",
    "yuv420p",
    clip,
  ]);
  return clip;
});
const list = join(work, "concat.txt"),
  temporary = join(work, "encoded.mp4");
assert(
  clips.every((path) => !path.includes("'")),
  "Use filenames without quote characters.",
);
writeFileSync(list, clips.map((path) => `file '${resolve(path)}'`).join("\n"));
run("ffmpeg", [
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  list,
  "-an",
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  temporary,
]);
const info = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_type",
    "-of",
    "json",
    temporary,
  ]),
);
const duration = Number(info.format.duration),
  bytes = statSync(temporary).size;
assert(
  duration < 90 && bytes < 10_000_000,
  "Video exceeds the duration or size limit. It remains outside the proposed files.",
);
assert(
  !info.streams.some((stream) => stream.codec_type === "audio"),
  "Recording must be silent.",
);
mkdirSync(dirname(output), { recursive: true });
renameSync(temporary, output);
run("ffmpeg", [
  "-y",
  "-i",
  output,
  "-filter_complex",
  "fps=6,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
  "-loop",
  "0",
  output.replace(/\.mp4$/, ".gif"),
]);
console.log(JSON.stringify({ duration, bytes }));

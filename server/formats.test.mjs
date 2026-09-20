import { test } from "node:test";
import assert from "node:assert/strict";

const { qualityToFormat } = await import("./ytdlp.js");

const args = (r) => r.post.join(" ");

test("mobile mode produces aac in an m4a container", () => {
  const r = qualityToFormat("audio", "1080p", "mp3", "192", true, "auto", true);
  assert.equal(r.ext, "m4a");
  assert.match(args(r), /--audio-format m4a/);
  assert.match(args(r), /-ar 44100/);
  assert.match(args(r), /-ac 2/);
  assert.match(args(r), /faststart/);
});

test("mobile overrides whatever audio format was selected", () => {
  for (const chosen of ["mp3", "wav", "flac", "opus", "ogg", "best"]) {
    const r = qualityToFormat("audio", "1080p", chosen, "192", true, "auto", true);
    assert.equal(r.ext, "m4a", `${chosen} should still come out as m4a in mobile mode`);
    assert.match(args(r), /--audio-format m4a/);
  }
});

test("mobile forces audio even when the caller asked for video", () => {
  const r = qualityToFormat("audio", "1080p", "mp3", "192", true, "mp4", true);
  assert.equal(r.ext, "m4a");
  assert.equal(r.format, "bestaudio/best");
});

test("m4a is a real option and no longer silently becomes mp3", () => {
  const r = qualityToFormat("audio", "1080p", "m4a", "192", true, "auto", false);
  assert.equal(r.ext, "m4a");
  assert.match(args(r), /--audio-format m4a/);
  assert.doesNotMatch(args(r), /--audio-format mp3/);
});

test("every audio format maps to the right codec and extension", () => {
  const expected = {
    mp3: ["mp3", "mp3"],
    m4a: ["m4a", "m4a"],
    aac: ["aac", "m4a"],
    opus: ["opus", "opus"],
    ogg: ["vorbis", "ogg"],
    wav: ["wav", "wav"],
    flac: ["flac", "flac"],
  };
  for (const [format, [codec, ext]] of Object.entries(expected)) {
    const r = qualityToFormat("audio", "1080p", format, "192", true, "auto", false);
    assert.equal(r.ext, ext, `${format} extension`);
    assert.match(args(r), new RegExp(`--audio-format ${codec}`), `${format} codec`);
  }
});

test("lossless formats ignore the bitrate setting", () => {
  for (const format of ["wav", "flac"]) {
    const r = qualityToFormat("audio", "1080p", format, "192", true, "auto", false);
    assert.match(args(r), /--audio-quality 0/);
  }
  const lossy = qualityToFormat("audio", "1080p", "mp3", "192", true, "auto", false);
  assert.match(args(lossy), /--audio-quality 192K/);
});

test("without ffmpeg audio falls back to a playable m4a stream", () => {
  const r = qualityToFormat("audio", "1080p", "mp3", "192", false, "auto", true);
  assert.equal(r.ext, "m4a");
  assert.deepEqual(r.post, []);
});

test("video modes are untouched by the mobile flag plumbing", () => {
  const mp4 = qualityToFormat("auto", "1080p", "mp3", "192", true, "auto", false);
  assert.equal(mp4.ext, "mp4");
  const webm = qualityToFormat("auto", "720p", "mp3", "192", true, "webm", false);
  assert.equal(webm.ext, "webm");
  const mute = qualityToFormat("mute", "480p", "mp3", "192", true, "auto", false);
  assert.equal(mute.ext, "mp4");
  assert.match(mute.format, /bestvideo/);
});

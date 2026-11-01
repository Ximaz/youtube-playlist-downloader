"""Format selection against real yt-dlp 2026.10.26 field values (Agent 327, Spring). A wrong pick is
silent: the download succeeds, with a dub, or a text manifest instead of media, in the file."""

import unittest

from app.services.youtube_service import YoutubeService


def audio(fid: str, abr: float, codec: str = "opus", lang: int = -1, quality: float = 3.0) -> dict:
    return {
        "format_id": fid,
        "abr": abr,
        "acodec": codec,
        "vcodec": "none",
        "url": "https://x",
        "protocol": "https",
        "language_preference": lang,
        "quality": quality,
    }


class PickAudio(unittest.TestCase):
    def test_original_language_beats_higher_bitrate_dub(self) -> None:
        formats = [
            audio("140-11", 129.5, "mp4a.40.2", lang=10),
            audio("251-10", 143.0),  # Hindi dub
            audio("251-11", 125.6, lang=10),  # English original
        ]
        self.assertEqual(YoutubeService()._pick_audio(formats)["format_id"], "251-11")

    def test_non_drc_beats_higher_bitrate_drc(self) -> None:
        formats = [audio("251-drc", 137.5, quality=2.5), audio("251", 137.4), audio("250", 70.0)]
        self.assertEqual(YoutubeService()._pick_audio(formats)["format_id"], "251")

    def test_opus_preferred_then_falls_back(self) -> None:
        opus, aac = audio("251", 100.0), audio("140", 129.8, "mp4a.40.2")
        self.assertEqual(YoutubeService()._pick_audio([aac, opus])["format_id"], "251")
        self.assertEqual(YoutubeService()._pick_audio([aac])["format_id"], "140")

    def test_hls_is_never_picked(self) -> None:
        hls = audio("234", 192.0) | {"protocol": "m3u8_native"}
        picked = YoutubeService()._pick_audio([hls, audio("251", 100.0)])
        self.assertEqual(picked["format_id"], "251")


class PickVideo(unittest.TestCase):
    def test_hls_is_never_picked(self) -> None:
        base = {"url": "https://x", "vcodec": "vp9", "acodec": "none"}
        direct = base | {"format_id": "271", "protocol": "https", "height": 858}
        hls = base | {"format_id": "620", "protocol": "m3u8_native", "height": 1080}
        self.assertEqual(YoutubeService()._pick_video([hls, direct])["format_id"], "271")
        self.assertIsNone(YoutubeService()._select([hls], "video", "620"))


if __name__ == "__main__":
    unittest.main()

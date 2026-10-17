"""YouTube Music catalogue sections as flat yt-dlp entries.

Built-in `youtube:music:search_url` returns only a bare `id`/`title` per hit
(no title at all for artists) and knows no playlists section, so yt-dlp would
fetch every video page to recover artist, album and duration. Everything is
already in the shelf renderer, so this plugin:

* returns rich flat entries for the songs, albums, artists and playlists
  sections of `https://music.youtube.com/search?q=...#<section>`;
* adds an artist page extractor (`talos-music:artist:<UC id>`) that lists the
  artist's own songs shelf and album carousel from the YouTube Music browse page.

Each entry carries `talos_kind` (song, album, artist, playlist). Albums use
their `OLAK5uy_` playlist id, which opens as an ordinary playlist.
"""

from __future__ import annotations

import re

from yt_dlp.extractor.youtube._search import YoutubeMusicSearchURLIE
from yt_dlp.extractor.youtube._tab import YoutubeTabBaseInfoExtractor
from yt_dlp.utils import parse_duration, traverse_obj

_SEPARATOR = re.compile(r"^\s*[\u2022\u00b7|]\s*$")
_ITEM = ("musicResponsiveListItemRenderer", "musicTwoRowItemRenderer")


def _runs_text(runs):
    return [
        run["text"]
        for run in (runs if isinstance(runs, list) else [])
        if isinstance(run, dict)
        and isinstance(run.get("text"), str)
        and not _SEPARATOR.match(run["text"])
    ]


def _column_runs(renderer, index):
    return traverse_obj(
        renderer,
        ("flexColumns", index, "musicResponsiveListItemFlexColumnRenderer", "text", "runs"),
    )


def _thumbnails(renderer):
    found = traverse_obj(
        renderer,
        (
            ("thumbnail", "thumbnailRenderer"),
            "musicThumbnailRenderer",
            "thumbnail",
            "thumbnails",
        ),
        get_all=False,
    )
    return [
        {k: t[k] for k in ("url", "width", "height") if k in t}
        for t in (found if isinstance(found, list) else [])
        if isinstance(t, dict) and isinstance(t.get("url"), str)
    ]


def _play_endpoint(renderer):
    return traverse_obj(
        renderer,
        (
            ("overlay", "thumbnailOverlay"),
            "musicItemThumbnailOverlayRenderer",
            "content",
            "musicPlayButtonRenderer",
            "playNavigationEndpoint",
        ),
        get_all=False,
    )


def _video_id(renderer):
    return traverse_obj(renderer, ("playlistItemData", "videoId")) or traverse_obj(
        _play_endpoint(renderer), ("watchEndpoint", "videoId")
    )


def _album_playlist_id(renderer):
    """The OLAK5uy_ playlist that plays an album, from its play button."""
    for candidate in (
        traverse_obj(_play_endpoint(renderer), ("watchPlaylistEndpoint", "playlistId")),
        traverse_obj(_play_endpoint(renderer), ("watchEndpoint", "playlistId")),
        traverse_obj(renderer, ("navigationEndpoint", "watchPlaylistEndpoint", "playlistId")),
    ):
        if isinstance(candidate, str) and candidate.startswith("OLAK5uy_"):
            return candidate
    return None


def _title(renderer):
    return traverse_obj(
        renderer,
        (
            ("title", ("flexColumns", 0, "musicResponsiveListItemFlexColumnRenderer", "text")),
            "runs",
            0,
            "text",
        ),
        get_all=False,
    )


def _subtitle_parts(renderer):
    runs = traverse_obj(renderer, ("subtitle", "runs")) or _column_runs(renderer, 1)
    return _runs_text(runs)


def _song_entry(renderer, video_id):
    title = _title(renderer)
    if not isinstance(title, str) or not title:
        return None
    runs = _column_runs(renderer, 1) or traverse_obj(renderer, ("subtitle", "runs")) or []
    parts = _runs_text(runs)
    album = None
    for run in runs:
        browse_id = traverse_obj(run, ("navigationEndpoint", "browseEndpoint", "browseId"))
        if isinstance(browse_id, str) and browse_id.startswith("MPRE") and run.get("text"):
            album = run["text"]
    duration = parse_duration(parts[-1]) if parts else None
    artists = [
        run["text"]
        for run in runs
        if isinstance(run.get("text"), str)
        and str(traverse_obj(run, ("navigationEndpoint", "browseEndpoint", "browseId")) or "").startswith("UC")
    ] or (parts[:1] if parts else [])
    return {
        "_type": "url",
        "ie_key": "Youtube",
        "talos_kind": "song",
        "id": video_id,
        "url": f"https://music.youtube.com/watch?v={video_id}",
        "title": title,
        "artists": artists,
        "album": album,
        "duration": duration if duration is not None else 0,
        "thumbnails": _thumbnails(renderer),
    }


def _collection_entry(renderer):
    """An album, artist or playlist row; the kind comes from the id it opens."""
    browse_id = traverse_obj(renderer, ("navigationEndpoint", "browseEndpoint", "browseId"))
    title = _title(renderer)
    if not isinstance(browse_id, str) or not isinstance(title, str) or not title:
        return None
    parts = _subtitle_parts(renderer)
    base = {
        "_type": "url",
        "title": title,
        "thumbnails": _thumbnails(renderer),
    }
    if browse_id.startswith("MPRE"):
        playlist_id = _album_playlist_id(renderer)
        if not playlist_id:
            return None
        # "Album - Artist - 2021"; the leading type label is localised.
        body = parts[1:] if len(parts) > 1 else parts
        year = body[-1] if body and re.fullmatch(r"\d{4}", body[-1]) else None
        artist = body[0] if body and body[0] != year else None
        return {
            **base,
            "ie_key": "YoutubeTab",
            "talos_kind": "album",
            "id": playlist_id,
            "url": f"https://music.youtube.com/playlist?list={playlist_id}",
            "channel": artist,
            "release_year": int(year) if year else None,
        }
    if browse_id.startswith("UC"):
        return {
            **base,
            "ie_key": "YoutubeTab",
            "talos_kind": "artist",
            "id": browse_id,
            "url": f"https://music.youtube.com/channel/{browse_id}",
        }
    if browse_id.startswith("VL"):
        # "Playlist - Owner - 991 views"; podcasts (MPSP...) are not listed.
        body = parts[1:] if len(parts) > 2 else parts[:1]
        return {
            **base,
            "ie_key": "YoutubeTab",
            "talos_kind": "playlist",
            "id": browse_id[2:],
            "url": f"https://music.youtube.com/playlist?list={browse_id[2:]}",
            "channel": body[0] if body else None,
        }
    return None


def _section_entry(renderer):
    video_id = _video_id(renderer)
    if video_id:
        entry = _song_entry(renderer, video_id)
        if entry:
            return entry
    return _collection_entry(renderer)


class TalosMusicSearchIE(YoutubeMusicSearchURLIE, plugin_name="talos-music"):
    """music.youtube.com/search?q=...#songs|albums|artists|playlists"""

    _SECTIONS = {
        **YoutubeMusicSearchURLIE._SECTIONS,
        "playlists": YoutubeMusicSearchURLIE._SECTIONS["community playlists"],
    }

    def _music_reponsive_list_entry(self, renderer):
        return _section_entry(renderer)


class TalosMusicArtistIE(YoutubeTabBaseInfoExtractor):
    IE_DESC = "YouTube Music artist page: songs shelf and album carousel"
    IE_NAME = "talos-music:artist"
    _VALID_URL = r"talos-music:artist:(?P<id>UC[\w-]+)"

    def _real_extract(self, url):
        artist_id = self._match_id(url)
        ytcfg = self._download_ytcfg("web_music", artist_id)
        headers = self.generate_api_headers(ytcfg=ytcfg, default_client="web_music")
        page = self._extract_response(
            item_id=artist_id,
            ep="browse",
            query={"browseId": artist_id},
            default_client="web_music",
            check_get_keys="contents",
            ytcfg=ytcfg,
            headers=headers,
        )
        sections = (
            traverse_obj(
                page,
                ("contents", "singleColumnBrowseResultsRenderer", "tabs", 0, "tabRenderer",
                 "content", "sectionListRenderer", "contents"),
            )
            or []
        )
        songs, albums, songs_playlist = [], [], None
        for section in sections:
            shelf = section.get("musicShelfRenderer") if isinstance(section, dict) else None
            carousel = section.get("musicCarouselShelfRenderer") if isinstance(section, dict) else None
            if shelf:
                for item in shelf.get("contents") or []:
                    renderer = item.get("musicResponsiveListItemRenderer")
                    video_id = _video_id(renderer) if renderer else None
                    entry = _song_entry(renderer, video_id) if video_id else None
                    if entry:
                        songs.append(entry)
                see_all = traverse_obj(
                    shelf,
                    (("bottomEndpoint", ("title", "runs", 0, "navigationEndpoint")),
                     "browseEndpoint", "browseId"),
                    get_all=False,
                )
                if isinstance(see_all, str) and see_all.startswith("VL"):
                    songs_playlist = see_all[2:]
            elif carousel:
                for item in carousel.get("contents") or []:
                    renderer = item.get("musicTwoRowItemRenderer")
                    entry = _collection_entry(renderer) if renderer else None
                    if entry and entry["talos_kind"] == "album":
                        albums.append(entry)
        name = traverse_obj(
            page,
            ("header", ("musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer"),
             "title", "runs", 0, "text"),
            get_all=False,
        )
        thumbnails = _thumbnails(
            traverse_obj(
                page,
                ("header", ("musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer")),
                get_all=False,
            )
            or {}
        )
        result = self.playlist_result(songs, artist_id, name or artist_id)
        result.update(
            {
                "talos_kind": "artist",
                "channel": name,
                "thumbnails": thumbnails,
                "talos_albums": albums,
                "talos_songs_playlist": songs_playlist,
            }
        )
        return result


__all__ = ["TalosMusicSearchIE", "TalosMusicArtistIE"]

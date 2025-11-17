# Youtube Playlist Downloader

This project lets you download Youtube videos in bulk as well as whole playlists
as long as they are marked `public` or `unlisted`.

It is based on the amazing work of [`LuanRT`](https://github.com/LuanRT) who
created a bunch of utilities to manipulate Youtube video and audio streams.

## Setup

### Bun installation

This project is powered by [`Bun`](https://bun.com/docs/installation), so you
must install it to get the proper environment.

### Installing dependencies

To install the project's dependencies, type the following command, once in the
project's directory :
```bash
bun install
```

## Downloaders

### Video

To download a single Youtube video, you can use the following command :

```bash
bun cmd:video --video-id <video-id> --output-folder ./video-streams
```

This will download both the audio and video streams, in separate files.

### Videos

To download a list of Youtube videos, you can use the following command :

```bash
bun cmd:videos --output-folder ./videos \
    --video-id <video-id-1> \
    --video-id <video-id-2> \
    --video-id <video-id-3>
```

This will download all video streams in the same folder. Both audio and video
streams are still stored in separate files, but in the same folder overall.

### Playlist

To download a whole Youtube playlist, you can use the following command :

```bash
bun cmd:playlist --playlist-id <playlist-id> --output-folder ./playlist
```

This will download all video streams in the same folder. Both audio and video
streams are still stored in separate files, but in the same folder overall.

## Web UI

A web UI is under construction, powered by [`Hono`](https://hono.dev/). It will
create different workers to treat the download process asynchronously while
providing a responsive user interface.

## What is comming up next

The web UI is not the only feature under construction, although it is the main
one.

I plan to add the audio and video muxer / convertor, as I already did in the
first version, using [`ffmpeg`](https://ffmpeg.org/). This will be mostly wanted
for Apple Music enjoyers as it will let you convert audio files with thumbnail
and audio metadata included in a file that is ready to be imported in the app.

It will also give you a built-in way to merge both audio and video streams that
are initially downloaded in separate files.

Finally, as in the first version of this project, all the downloaded as well as
the converted files will end up in a local S3 server to store the content, in
case it gets deleted from Youtube or simply to give you a way to export your
favorite artifacts easily. It will be powered by [`MinIO`](https://www.min.io/).

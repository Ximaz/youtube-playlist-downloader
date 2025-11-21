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

To download a single Youtube video, use the following command :

```bash
bun cmd:video --video-id <video-id> --output-folder ./video-streams
```

This will download both the audio and video streams, in separate files.

If you want to build a compiled binary instead, use this instead :
```bash
bun build:cmd:video
./bin/youtube-video-downloader --video-id <video-id> \
    --output-folder ./video-streams
```
### Videos

To download a list of Youtube videos, use the following command :

```bash
bun cmd:videos --output-folder ./videos \
    --video-id <video-id-1> \
    --video-id <video-id-2> \
    --video-id <video-id-3>
```

This will download all video streams in the same folder. Both audio and video
streams are still stored in separate files, but in the same folder overall.

If you want to build a compiled binary instead, use this instead :
```bash
bun build:cmd:videos
./bin/youtube-videos-downloader --output-folder ./videos \
    --video-id <video-id-1> \
    --video-id <video-id-2> \
    --video-id <video-id-3>
```
### Playlist

To download a whole Youtube playlist, use the following command :

```bash
bun cmd:playlist --playlist-id <playlist-id> --output-folder ./playlist
```

This will download all video streams in the same folder. Both audio and video
streams are still stored in separate files, but in the same folder overall.

If you want to build a compiled binary instead, use this instead :
```bash
bun build:cmd:playlist
./bin/youtube-playlist-downloader --playlist-id <playlist-id> \
    --output-folder ./playlist
```

### Build all binaries

If you want to build all the binaries directly, use the following command :
```bash
bun build:cli
```

All binaries will be output to the `bin` folder.

## Web UI

A web application can be deployed in order to let you use the features easily.
Powered by [`Hono`](https://hono.dev/) and [`Nuxt`](https://nuxt.com/), it can
create different workers to treat the download process asynchronously while
providing a responsive user interface.

### Development deployment

Beforehand, make sure both Redis and MinIO servers are reachable. To make it
easier, a `docker-compose.development.yml` file is placed in the `deploy/`
directory to let you deploy those two applications locally and easily.

You can make sure they both are started using the following command :
```bash
docker compose -f deploy/docker-compose.development.yml up \
    ypd-minio \
    ypd-redis \
    -d
```

Then, you will have to install dependencies :
```bash
bun install
cd web/backend && bun install && cd -
cd web/frontend && pnpm install && cd -
```

To deploy the app for development purposes, you can type the following command
to start the web services :
```bash
bun web:backend:dev  # run the backend service
bun web:frontend:dev # run the frontend service
```

Then, the backend and frontend applications should be reachable on port `3000`
and `4000` respectively.

### Production deployment

To deploy the app, you can choose between two different kinds of deployments :
- `development` : builds the Docker image from the repository,
- `production`  : pull the Docker image from the GitHub repository.

You can use the following command to deploy :
```bash
docker compose -f deploy/docker-compose.[deployment-type].yml up
```

If everything works as expected, you should be able to access the frontend app
on port `8081`.

## Features

### OAuth2 Setup

To use the account playlists feature, you need OAuth2 credentials:

1. Go to the [`Google Cloud Console`](https://console.cloud.google.com/).

2. Create a project and generate OAuth2 credentials (Client ID & Client Secret).

3. Set the redirect URIs :
- for local development : `http://localhost:4000/oauth/callback`,
- for local production : `http://localhost:8081/oauth/callback`.

4. Add your credentials in `.env` (or `.env.production.local`)
```bash
# ./web/frontend/.env
BACKEND_API=http://localhost:3000
GOOGLE_CLIENT_ID=...-....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...-...
PORT=3001
```

### [`FFmpeg`](https://ffmpeg.org/): convertion and muxing

This project exposes ways to convert audio and video streams as well as muxing
them together. This will be mostly wanted for Apple Music enjoyers as it will
let you convert audio files with thumbnail and audio metadata included in a file
that is ready to be imported in the app.

### [`MinIO`](https://www.min.io/): file archiving

All downloaded, and converted, files will end up in a local S3 server to store
the content, in case it gets deleted from Youtube or simply to give you a way to
export your favorite artifacts easily.

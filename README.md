# YouTube Playlist Downloader

This project was design to let people download their favorite YouTube playlists
in a single bulk operation.

We all know websites to download YouTube videos at once, but not only is this
non very user friendly when it comes to playlist, it is also infested with ads.

Finally, it lets you decide whether you want audio, video, or both.

You also have the ability to choose :

- the original streams : WEBA (audio) and WEBM (video);
- the converted streams : M4A (audio) and MP4 (video).

Note that the original streams are widely supported formats, and pefectly fine.
However, for Apple Music users, the WEBA audio is not recognized. That's why I
choosed to convert them into M4A, as not only is it supported, but it also
includes thumbnails and artists metadata. Effortless playlist beauty.

## Usage

This project is aimed to be self-hosted. For that reason, I provide docker
images for both the backend and the frontend of the application. You can use
this `docker-compose.yml` file as an example :

```yml
services:
  # This service is used to store downloaded audios and videos, along with their
  # converted form if required, in order to avoid downloading the same streams
  # again and again. YouTube APIs will thank you, and it makes all your streams
  # portable.
  ypd-minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z-cpuv1
    container_name: ypd-minio
    ports:
      - "9000:9000"
      - "9001:9001"
    networks:
      - ypd-network
    volumes:
      - ypd-minio-volume:/data:rw
    environment:
      MINIO_ROOT_USER: minioadmin # You may want to change that.
      MINIO_ROOT_PASSWORD: minioadmin # You may want to change that.
    command: server /data --console-address ":9001"
    restart: unless-stopped

  # This redis cache is used to store metadata information about playlists and
  # related videos. As they are pretty heavy, if not cached, YouTube will rate-
  # limit you and you won't be able to use the project.
  ypd-redis:
    image: redis:8.2.1-bookworm
    container_name: ypd-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    networks:
      - ypd-network
    volumes:
      - ypd-redis-volume:/data:rw

  # This is the actual backend. It contains all the business logic allowing the
  # project to work.
  ypd-backend:
    depends_on:
      - ypd-minio
      - ypd-redis
    image: ghcr.io/ximaz/youtube-playlist-downloader/backend
    container_name: ypd-backend
    ports:
      - "8080:3000"
    networks:
      - ypd-network
    environment:
      - S3_API_REGION=eu-west-1
      - S3_API_ENDPOINT=http://ypd-minio:9000
      - S3_API_ACCESS_KEY_ID=minioadmin # Must match ypd-minio variables.
      - S3_API_SECRET_ACCESS_KEY=minioadmin # Must match ypd-minio variables.
      - REDIS_HOST=ypd-redis
      - REDIS_PORT=6379
      - WORKERS_CAPACITY=3
    restart: unless-stopped

  # This is the frontend. It is what makes the project usable through your web
  # browser.
  ypd-frontend:
    depends_on:
      - ypd-backend
    image: ghcr.io/ximaz/youtube-playlist-downloader/frontend
    container_name: ypd-frontend
    ports:
      - 8081:3001
    networks:
      - ypd-network
    environment:
      - PORT=3001
      - BACKEND_API=http://ypd-backend:3000
    restart: unless-stopped

volumes:
  ypd-minio-volume:
  ypd-redis-volume:

networks:
  ypd-network:
```

Once you have this file, you should be able to type :
`docker compose up -d`
to start all the services, and then access the web application via your web
browser at [http://localhost:8081](http://localhost:8081)

## Credits

This project would not be alive if it was not for the work of [LuanRT](https://github.com/LuanRT).

In order to download video streams and get playlist metadata, I am using their
library called [googlevideo](https://github.com/LuanRT/googlevideo), which is
mind blowing.

I genuenly would love to know how they figured everything out, but anyway, this
is a masterpiece, so thanks for the project.

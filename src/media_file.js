import { Record } from 'immutable';
import _ from 'lodash';
import ObjectPath from 'object-path';
import { sprintf } from 'sprintf-js';
import { parse } from 'shell-quote';
import { fsAccess, ensureDir} from './helpers/path_helper';
import JSZip from 'jszip';
import pica from 'pica';
import loadImage from "load-image";

const canvasBuffer = global.require('electron-canvas-to-buffer');
const ffmpeg = global.require('fluent-ffmpeg');
const fs = global.require('fs');
const path = global.require('path');
const childProcess = global.require('child_process');
const stat = path => {
  return new Promise((resolve, reject) => {
    fs.stat(path, (err, result) => {
      if (err)
        return reject(err);

      resolve(result);
    });
  });
};
const readFile = path => {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (err, result) => {
      if (err)
        return reject(err);

      resolve(result);
    });
  });
}
const writeFile = (path, data) => {
  return new Promise((resolve, reject) => {
    fs.writeFile(path, data, (err) => {
      if (err)
        return reject(err);

      resolve();
    });
  });
}
const loadImagePromisified = (fileOrBlobOrUrl, options = {}) => {
  return new Promise((resolve, reject) => {
    loadImage(fileOrBlobOrUrl, (img) => {
      if (img.type === "error") {
        console.warn(`Error loading image ${fileOrBlobOrUrl}`);
        reject(img);
      } else {
        resolve(img);
      }
    }, options);
  });
}
const resizeCanvasPromisified = (from, to, options = {}) => {
  return new Promise((resolve, reject) => {
    pica.resizeCanvas(from, to, options, (err) => {
      if (err) {
        console.warn(`Error resize canvas`);
        reject(err);
      } else {
        resolve(to);
      }
    });
  });
}

const DOWNCASE_MOVIE_EXTENSIONS = [
  "3g2",
  "3gp",
  "asf",
  "avi",
  "divx",
  "flv",
  "m2v",
  "m4v",
  "mkv",
  "mov",
  "mp2",
  "mp4",
  "mpe",
  "mpeg",
  "mpg",
  "nsv",
  "ogm",
  "qt",
  "rm",
  "rmvb",
  "vob",
  "wmv",
];

const MOVIE_EXTENSIONS = DOWNCASE_MOVIE_EXTENSIONS.concat(
  DOWNCASE_MOVIE_EXTENSIONS.map(ext => ext.toUpperCase())
);

const DOWNCASE_IMAGE_EXTENSIONS = [
  "bmp",
  "jpg",
  "png",
];
const IMAGE_EXTENSIONS = DOWNCASE_IMAGE_EXTENSIONS.concat(
  DOWNCASE_IMAGE_EXTENSIONS.map(ext => ext.toUpperCase())
);

export default class MediaFile extends Record({
  id: null,
  basename: null,
  fullpath: null,
  filesize: null,
  ctime: null,
  width: null,
  height: null,
  duration: null,
  vcodec: null,
  vBitRate: null,
  acodec: null,
  aBitRate: null,
  sampleRate: null,
  thumbnailVersion: 0,
  favorited: false
}) {
  get basenameWithoutExtension() {
    return path.basename(this.basename, path.extname(this.basename));
  }

  get extname() {
    return path.extname(this.basename).substr(1);
  }

  async isPersistedAsync() {
    try {
      let result = null;
      if (this.id) {
        result = await global.db.files.get(this.id);
      } else {
        result = await global.db.files.where("fullpath").equals(this.fullpath).first();
      }
      return !!result;
    } catch (err) {
      return false;
    }
  }

  get isMovie() {
    return false;
  }

  get thumbnailDir() {
    return path.dirname(path.join(global.config.thumbnail.dir, this.fullpath));
  }

  get thumbnails() {
    let results = [];
    for (let i = 1; i <= global.config.thumbnail.count; ++i) {
      results.push(this.thumbnailPath(i));
    }
    return results;
  }

  get resolution() {
    return null;
  }

  get durationStr() {
    return null;
  }

  get mainCommand() {
    return global.config.getCommand(this.extname);
  }

  get commands() {
    return global.config.getAllCommands(this.extname);
  }

  thumbnailPath(index) {
    return path.join(this.thumbnailDir, `${this.basenameWithoutExtension}_${index}.png`)
  }

  async hasAllThumbnail(count) {
    let results = [];
    for (let i = 1; i <= count; ++i) {
      results.push(await fsAccess(this.thumbnailPath(i)));
    }

    return _.every(results);
  }

  existsSync() {
    return fs.existsSync(this.fullpath);
  }

  execute(commandName = null) {
    let cmd, args = null;

    if (commandName) {
      [cmd, ...args] = parse(this.commands[commandName]);
    } else {
      [cmd, ...args] = parse(this.mainCommand);
    }

    childProcess.spawn(
      cmd,
      [...args, this.fullpath],
      {detached: true}
    );
  }

  async createThumbnail({ count, size }, force = false) {
    return true;
  }

  getMediaInfo() {
    return new Promise((resolve, reject) => {
      resolve({});
    });
  }

  async save() {
    const dbData = await this.toDbData();
    await global.db.files.add(dbData);
    const fromDb = await global.db.files.where("fullpath").equals(this.fullpath).first();
    return MediaFile.build(fromDb);
  }

  async toDbData() {
    return {
      basename: this.basename,
      fullpath: this.fullpath,
      filesize: this.filesize,
      ctime: this.ctime,
    };
  }

  async toggleFavorite() {
    try {
      await global.db.files.where("id").equals(this.id).modify({favorited: !this.favorited});
      return this.set("favorited", !this.favorited);
    } catch (err) {
      return this;
    }
  }
}

class MovieFile extends MediaFile {
  get isMovie() {
    return true;
  }

  get resolution() {
    return `${this.width}x${this.height}`;
  }

  get durationStr() {
    if (isNaN(this.duration)) {
      return "NaN";
    }
    const hour = Math.floor(this.duration / 3600);
    const min = Math.floor((this.duration - hour * 3600) / 60);
    const sec = Math.floor((this.duration - hour * 3600 - min * 60) % 60);
    return sprintf("%d:%02d:%02d", hour, min, sec);
  }

  async createThumbnail({ count, size }, force = false) {
    try {
      await ensureDir(this.thumbnailDir);
      if (!force && await this.hasAllThumbnail(count))
        return;

      console.log(`create thumbnail: ${this.fullpath}`);
      let results = [];
      for (let i = 1; i <= count; ++i) {
        results.push(new Promise((resolve, reject) => {
          fsAccess(this.thumbnailPath(i)).then(hasThumbnail => {
            if (!force && hasThumbnail) {
              return resolve();
            }
            childProcess.execFile(
              'ffmpegthumbnailer',
              [
                "-i", this.fullpath,
                "-o", this.thumbnailPath(i),
                "-s", size,
                "-t", `${Math.round(Math.min(100/(count + 1 - i), 99))}%`,
              ],
              { maxBuffer: 400 * 1024 },
              (err, stdout, stderr) => {
                if (err) {
                  console.warn(this.fullpath, err);
                  resolve();
                } else {
                  resolve();
                }
              }
            );
          });
        }));
      }
      if (_.isEmpty(results))
        return;

      await Promise.all(results);
      return
    } catch (err) {
      console.warn(err);
    }
  }

  getMediaInfo() {
    return new Promise((resolve, reject) => {
      try {
        ffmpeg(this.fullpath).ffprobe((err, data) => {
          if (err) {
            console.log(err);
            resolve(null);
          } else {
            resolve(data);
          }
        });
      } catch (err) {
        console.warn(this.fullpath, err);
        resolve(null);
      }
    });
  }

  async toDbData() {
    const base = {
      basename: this.basename,
      fullpath: this.fullpath,
      filesize: this.filesize,
      ctime: this.ctime,
    };
    const info = await this.getMediaInfo();

    if (info == null) {
      return base;
    }

    const videoStream = _.find(info.streams, stream => {
      return stream.codec_type == "video";
    }) || {};
    const audioStream = _.find(info.streams, stream => {
      return stream.codec_type == "audio";
    }) || {};
    const videoInfo = {
      width: videoStream.width,
      height: videoStream.height,
      duration: parseInt(videoStream.duration),
      vcodec: videoStream.codec_name,
      vBitRate: parseInt(videoStream.bit_rate),
    }
    if (isNaN(videoInfo.duration)) {
      videoInfo.duration = parseInt(ObjectPath.get(info, 'format.duration'));
    }
    const audioInfo = audioStream === null ? {} : {
      acodec: audioStream.codec_name,
      aBitRate: parseInt(audioStream.bit_rate),
      sampleRate: parseInt(audioStream.sample_rate),
    }

    return _.extend(base, videoInfo, audioInfo);
  }
}

class ArchiveFile extends MediaFile {
  async createThumbnail({ count, size }, force = false) {
    try {
      await ensureDir(this.thumbnailDir);
      if (!force && await this.hasAllThumbnail(count))
        return;

      console.log(`create thumbnail: ${this.fullpath}`);

      const targets = await this.__getImageEntries(count);

      for (let i = 1; i <= targets.length; ++i) {
        await this.__processCreateThumbnail(targets[i-1], i, size, force);
      }
    } catch (err) {
      console.warn(err);
    }
  }

  async __getImageEntries(count) {
    const data = await readFile(this.fullpath);
    const zip = await JSZip.loadAsync(data);
    const imageEntries = zip.filter((relativePath, zo) => {
      return _.includes(IMAGE_EXTENSIONS, path.extname(relativePath).substr(1))
    });
    const coverEntry = _.find(imageEntries, entry => {
      return entry.name.match(/cover/i);
    });
    const chunked = _.chain([coverEntry].concat(imageEntries))
      .compact()
      .chunk(count)
      .value();

    if (chunked.length >= count) {
      return _.take(chunked.map(n => _.first(n)), count);
    } else {
      return _.first(chunked) || [];
    }
  }


  async __processCreateThumbnail(target, i, size, force) {
    try {
      const hasThumbnail = await fsAccess(this.thumbnailPath(i));
      if (!force && hasThumbnail)
        return;

      const arrayBuf = await target.async("arraybuffer")
      const blob = new Blob([arrayBuf], {type: this.getMimeType(target.name)});
      const blobUrl = global.URL.createObjectURL(blob);
      const canvas = await loadImagePromisified(blob, {canvas: true});
      global.URL.revokeObjectURL(blobUrl);

      const toCanvas = document.createElement('canvas');
      toCanvas.width = parseInt(size);
      toCanvas.height = Math.round(canvas.height / (canvas.width / parseInt(size)));

      const resultCanvas = await resizeCanvasPromisified(canvas, toCanvas);
      const buffer = canvasBuffer(toCanvas, 'image/png');
      await writeFile(this.thumbnailPath(i), buffer);
    } catch (err) {
      console.warn(err);
      return;
    }
  }

  getMimeType(name) {
    const extname = path.extname(name).substr(1);
    switch (extname) {
      case "jpg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "bmp":
        return "image/bmp";
      default:
        return "image/png";
    }
  }
}

MediaFile.build = (data) => {
  const extname = path.extname(data.basename).substr(1);
  if (_.includes(MOVIE_EXTENSIONS, extname)) {
    return new MovieFile(data);
  } else {
    return new ArchiveFile(data);
  }
};

MediaFile.buildByFileAsync = async (filepath) => {
  let s = await stat(filepath);
  let data = {
    basename: path.basename(filepath),
    fullpath: filepath,
    filesize: s.size,
    ctime: s.ctime
  };
  return MediaFile.build(data);
}

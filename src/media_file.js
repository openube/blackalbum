let fs = global.require('fs');
let path = global.require('path');
let fsExtra = global.require('fs-extra');
let childProcess = global.require('child_process');
import { Record } from 'immutable';
import _ from 'lodash';
import ffmpeg from 'fluent-ffmpeg';
import denodeify from 'denodeify';
import moment from 'moment';
import { parse } from 'shell-quote';

function fsAccess(filePath) {
  return new Promise((resolve, reject) => {
    fs.access(filePath, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function ensureDir(dirPath) {
  return new Promise((resolve, reject) => {
    fsExtra.ensureDir(dirPath, (err) => {
      if (err) {
        console.log(err);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

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
  sampleRate: null
}) {
  get basenameWithoutExtension() {
    return path.basename(this.basename, path.extname(this.basename));
  }

  get extname() {
    return path.extname(this.basename).substr(1);
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
    return `${this.width}x${this.height}`;
  }

  get durationStr() {
    let d = moment.utc(this.duration * 1000);
    return d.format("H:mm:ss");
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

  async createThumbnail({ count, size }) {
    await ensureDir(this.thumbnailDir);
    let results = [];
    for (let i = 1; i <= count; ++i) {
      results.push(new Promise((resolve, reject) => {
        fsAccess(this.thumbnailPath(i)).then(hasThumbnail => {
          if (!hasThumbnail) {
            childProcess.execFile(
              'ffmpegthumbnailer',
              [
                "-i", this.fullpath,
                "-o", this.thumbnailPath(i),
                "-s", size,
                "-t", `${Math.round(Math.min(100/(count + 1 - i), 99))}%`,
              ],
              (err, stdout, stderr) => {
                if (err) {
                  console.log(err);
                  resolve(false);
                } else {
                  resolve(true);
                }
              }
            );
          } else {
            resolve(false);
          }
        });
      }));
    }
    return await Promise.all(results);
  }

  getMediaInfo() {
    return new Promise((resolve, reject) => {
      ffmpeg(this.fullpath).ffprobe((err, data) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  async toDbData() {
    let info = await this.getMediaInfo();
    let videoStream = _.find(info.streams, stream => {
      return stream.codec_type == "video";
    });
    let audioStream = _.find(info.streams, stream => {
      return stream.codec_type == "audio";
    });
    let videoInfo = videoStream === null ? {} : {
      width: videoStream.width,
      height: videoStream.height,
      duration: parseInt(videoStream.duration),
      vcodec: videoStream.codec_name,
      vBitRate: parseInt(videoStream.bit_rate),
    }
    let audioInfo = audioStream === null ? {} : {
      acodec: audioStream.codec_name,
      aBitRate: parseInt(audioStream.bit_rate),
      sampleRate: parseInt(audioStream.sample_rate),
    }

    return _.extend({
      basename: this.basename,
      fullpath: this.fullpath,
      filesize: this.filesize,
      ctime: this.ctime,
    }, videoInfo, audioInfo);
  }
}

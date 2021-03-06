/* @flow */

let path = global.require('path');
let fs = global.require('fs');
let fsExtra = global.require('fs-extra');
let process = global.require('process');
let app = global.require('electron').remote.app;

export const appDir = app.getPath('userData');
export const yamlConfigFile = path.join(appDir, "config.yml");
export const jsonConfigFile = path.join(appDir, "config.json");
export const defaultThumbnailDir = path.join(appDir, "thumbnails");

export function configFile(): string {
  try {
    fs.accessSync(yamlConfigFile);
    return yamlConfigFile;
  } catch (err) {
    try {
      fs.accessSync(jsonConfigFile);
      return jsonConfigFile;
    } catch (err) {
      console.log("configerror");
      throw err;
    }
  }
}

export function fsAccess(filePath: string): Promise {
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

export function ensureDir(dirPath: string): Promise {
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

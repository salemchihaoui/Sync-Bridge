import dotenv from "dotenv";
dotenv.config();

import chokidar from "chokidar";
import { Client } from "basic-ftp";
import { Client as SCPClient } from "node-scp";
import ignore from "ignore";
import fs from "fs/promises";
import * as path from "path";
import SFTPClient from "ssh2-sftp-client";
import notifier from "node-notifier";

class FileSyncApp {
  constructor() {
    this.localDir = process.env.LOCAL_DIR || "";
    this.remoteDir = process.env.REMOTE_DIR || "";
    this.serverConfig = null;
    this.ignoreRules = null;
    this.connectionType = process.env.CONNECTION_TYPE || "ftp";
    this.ig = ignore();
    this.retryAttempts = parseInt(process.env.RETRY_ATTEMPTS) || 3;
    this.retryDelay = parseInt(process.env.RETRY_DELAY) || 5000;
    this.connectionTimeout = parseInt(process.env.CONNECTION_TIMEOUT) || 10000;
    this.clients = {
      ftp: new Client(),
      sftp: new SFTPClient(),
      scp: null,
    };
  }

  sendNotification(title, message) {
    notifier.notify({
      title,
      message,
      sound: true,
      timeout: 1,
    });
  }

  async initialize() {
    try {
      this.serverConfig = {
        host: process.env.HOST,
        port: process.env.PORT || 22,
        username: process.env.USER,
        password: process.env.PASSWORD,
        secure: this.connectionType !== "ftp",
        timeout: this.connectionTimeout,
      };

      if (process.env.USE_GITIGNORE === "true") {
        try {
          const gitignoreContent = await fs.readFile(
            path.join(this.localDir, ".gitignore"),
            "utf8"
          );
          this.ig.add(gitignoreContent);
        } catch (err) {
          console.log(
            "No .gitignore file found, continuing without ignore rules"
          );
        }
      }

      await this.testConnection();
      return true;
    } catch (err) {
      console.error("Initialization error:", err.message);
      this.sendNotification(
        "FileSyncApp Error",
        `Initialization failed: ${err.message}`
      );
      return false;
    }
  }

  async getClient() {
    switch (this.connectionType) {
      case "sftp":
        if (!this.clients.sftp.sftp) {
          await this.clients.sftp.connect(this.serverConfig);
        }
        return this.clients.sftp;
      case "scp":
        if (!this.clients.scp) {
          this.clients.scp = await SCPClient(this.serverConfig);
        }
        return this.clients.scp;
      case "ftp":
        if (!this.clients.ftp.connected) {
          await this.clients.ftp.access(this.serverConfig);
        }
        return this.clients.ftp;
      default:
        throw new Error(`Unsupported connection type: ${this.connectionType}`);
    }
  }

  async closeClient(client) {
    if (this.connectionType === "sftp" && client === this.clients.sftp) {
      return;
    }
    switch (this.connectionType) {
      case "scp":
        await client.close();
        break;
      case "ftp":
        client.close();
        break;
    }
  }

  async testConnection() {
    const client = await this.getClient();
    try {
      console.log(
        `${this.connectionType.toUpperCase()} connection test successful`
      );
      this.sendNotification(
        "Connection Success",
        `${this.connectionType.toUpperCase()} connection test successful`
      );
    } finally {
      await this.closeClient(client);
    }
  }

  async handleFileOperation(operation, filePath) {
    const client = await this.getClient();
    try {
      const relativePath = path.relative(this.localDir, filePath);
      if (this.shouldSkipFile(relativePath)) return;

      const remoteFilePath = this.getRemotePath(relativePath);
      await operation(client, filePath, remoteFilePath);
    } finally {
      await this.closeClient(client);
    }
  }

  shouldSkipFile(relativePath) {
    if (
      !relativePath ||
      relativePath.trim() === "" ||
      path.isAbsolute(relativePath)
    ) {
      return;
    }
    return this.ig.ignores(relativePath);
  }

  getRemotePath(relativePath) {
    return path.join(this.remoteDir, relativePath).replace(/\\/g, "/");
  }

  async uploadFile(client, localPath, remotePath) {
    const remoteDir = path.dirname(remotePath);
    await this.createRemoteFolder(client, remoteDir);

    switch (this.connectionType) {
      case "sftp":
        await client.put(localPath, remotePath);
        break;
      case "scp":
        await client.uploadFile(localPath, remotePath);
        break;
      case "ftp":
        await client.uploadFrom(localPath, remotePath);
        break;
    }
    console.log(
      `Uploaded via ${this.connectionType.toUpperCase()}: ${localPath}`
    );
    this.sendNotification(
      `File Upload via ${this.connectionType.toUpperCase()}`,
      `path: ${localPath}`
    );
  }

  async deleteFile(client, localPath, remotePath) {
    try {
      switch (this.connectionType) {
        case "sftp":
          const exists = await client.exists(remotePath);
          if (exists === "d") await client.rmdir(remotePath, true);
          else if (exists === "-") await client.delete(remotePath);
          break;
        case "scp":
          await client
            .deleteFile(remotePath)
            .catch(() => console.log(`Path does not exist: ${remotePath}`));
          break;
        case "ftp":
          await client
            .remove(remotePath)
            .catch(() => console.log(`Path does not exist: ${remotePath}`));
          break;
      }
      console.log(
        `Deleted via ${this.connectionType.toUpperCase()}: ${localPath}`
      );
      this.sendNotification(
        `Deleted via ${this.connectionType.toUpperCase()}`,
        `Path: ${localPath}`
      );
    } catch (err) {
      console.error(`Error deleting ${remotePath}: ${err.message}`);
    }
  }

  async createRemoteFolder(client, remoteDir) {
    try {
      switch (this.connectionType) {
        case "sftp":
          await client.mkdir(remoteDir, true);
          break;
        case "scp":
          await client.exec(`mkdir -p ${remoteDir}`);
          break;
        case "ftp":
          await client.ensureDir(remoteDir);
          break;
      }
      console.log(`Created remote folder: ${remoteDir}`);
    } catch (err) {
      console.error(`Error creating remote folder ${remoteDir}:`, err.message);
    }
  }

  async watch() {
    console.log(`Watching for changes in ${this.localDir}`);
    this.sendNotification("Watching for changes", `in ${this.localDir}`);

    const watcher = chokidar.watch(this.localDir, {
      ignored: [/(^|[\/\\])\./, (path) => this.shouldSkipFile(path)],
      persistent: true,
      ignoreInitial: true,
      ignorePermissionErrors: true,
    });

    watcher
      .on("add", (path) =>
        this.handleFileOperation(this.uploadFile.bind(this), path)
      )
      .on("change", (path) =>
        this.handleFileOperation(this.uploadFile.bind(this), path)
      )
      .on("unlink", (path) =>
        this.handleFileOperation(this.deleteFile.bind(this), path)
      )
      .on("unlinkDir", (path) =>
        this.handleFileOperation(this.deleteFile.bind(this), path)
      )
      .on("error", (error) => console.error(`Watcher error: ${error.message}`));
  }

  async start() {
    const initialized = await this.initialize();
    if (initialized) {
      await this.watch();
    } else {
      console.error("Failed to initialize the application");
      process.exit(1);
    }
  }
}

const app = new FileSyncApp();
app.start().catch(console.error);
process.on("exit", async () => {
  if (app.clients.sftp.sftp) {
      await app.clients.sftp.end();
      console.log("SFTP connection closed");
  }
});

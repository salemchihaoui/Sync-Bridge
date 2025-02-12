import { WebSocketServer } from "ws";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

import chokidar from "chokidar";
import { Client } from "basic-ftp";
import { Client as SCPClient } from "node-scp";
import ignore from "ignore";
import fs from "fs";
import * as path from "path";
import SFTPClient from "ssh2-sftp-client";
import notifier from "node-notifier";
import { fileURLToPath } from "url";
import open from 'open';

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
    this.wsclients = new Set();
  }

  sendNotification(title, message) {
    if (process.env.USE_NODENOTIFIER === "on") {
      notifier.notify({
        title,
        message,
        sound: true,
        timeout: 1,
      });
    }
    // Send notification to all WebSocket clients
    const payload = JSON.stringify({ title, message });
    this.wsclients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
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


const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.static("public"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectionsFile = path.join(__dirname, "../connections.json");

function loadConnections() {
  try {
    if (fs.existsSync(connectionsFile)) {
      const data = fs.readFileSync(connectionsFile, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading connections:", error);
  }
  return [];
}

function saveConnection(connection) {
  try {
    const existingConnections = fs.existsSync(connectionsFile)
      ? JSON.parse(fs.readFileSync(connectionsFile, "utf8"))
      : [];

    const existingIndex = existingConnections.findIndex(
      (conn) => conn.uid === connection.uid
    );

    if (existingIndex !== -1) {
      existingConnections[existingIndex] = connection;
    } else {
      existingConnections.push(connection);
    }

    fs.writeFileSync(
      connectionsFile,
      JSON.stringify(existingConnections, null, 2),
      "utf8"
    );

    console.log("Connection saved successfully!");
    app.start().catch(console.error);
  } catch (error) {
    console.error("Error saving connection:", error);
    throw error;
  }
}

expressApp.get("/load-connections", (req, res) => {
  try {
    const connections = loadConnections();
    res.status(200).json(connections);
  } catch (error) {
    console.error("Error loading connections:", error);
    res.status(500).send("Failed to load connections.");
  }
});

function validateConnectionData(data) {
  const requiredFields = [
    "CONNECTION_TYPE",
    "HOST",
    "PORT",
    "USER",
    "PASSWORD",
    "LOCAL_DIR",
    "REMOTE_DIR",
  ];
  const missingFields = requiredFields.filter((field) => !data[field]);
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
  }
}

expressApp.post("/save-connection", async (req, res) => {
  try {
    validateConnectionData(req.body);

    const { uid,name, ...envData } = req.body;
    saveConnection(req.body);

    const envFileContent = Object.entries(envData)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const envPath = path.join(__dirname, "../.env");
    await fs.promises.writeFile(envPath, envFileContent, "utf8");

    dotenv.config();

    // Update application-specific properties with new environment variables
    app.localDir = process.env.LOCAL_DIR || app.localDir;
    app.remoteDir = process.env.REMOTE_DIR || app.remoteDir;
    app.connectionType = process.env.CONNECTION_TYPE || app.connectionType;
    app.retryAttempts = parseInt(process.env.RETRY_ATTEMPTS) || app.retryAttempts;
    app.retryDelay = parseInt(process.env.RETRY_DELAY) || app.retryDelay;
    app.connectionTimeout = parseInt(process.env.CONNECTION_TIMEOUT) || app.connectionTimeout;
    
    res.status(200).send("Connection saved successfully!");
  } catch (error) {
    console.error("Error saving connection:", error);
    res.status(400).send(`Failed to save connection: ${error.message}`);
  }
});

const UI_PORT = 4000;
expressApp.listen(UI_PORT, () => {
  console.log(`UI Server running at http://localhost:${UI_PORT}`);
  open(`http://localhost:${UI_PORT}`, 'sync-bridge');
});

const app = new FileSyncApp();
// Set up WebSocket Server
const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws) => {
  app.wsclients.add(ws);

  ws.on("close", () => {
    app.wsclients.delete(ws);
  });
});

process.on("exit", async () => {
  if (app.clients.sftp.sftp) {
    await app.clients.sftp.end();
    console.log("SFTP connection closed");
  }
});

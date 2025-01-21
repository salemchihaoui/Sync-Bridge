# Sync Bridge

Sync Bridge is a powerful file synchronization application designed to bridge the gap between local and remote directories using various connection protocols like FTP, SFTP, and SCP. The application ensures efficient file management, including uploading, deleting, and monitoring changes in real-time.

## Features
- **Multi-protocol Support:** Works with FTP, SFTP, and SCP.
- **Real-time Sync:** Automatically detects and syncs file changes.
- **Ignore Rules:** Supports `.gitignore`-style file exclusion.
- **Retry Mechanism:** Handles connection retries with customizable settings.
- **Notifications:** Displays system notifications for key events.
- **Cross-platform:** Compatible with Windows, macOS, and Linux.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/salemchihaoui/sync-bridge.git
   cd sync-bridge
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file in the project root
    ```bash
   CONNECTION_TYPE=sftp # ftp, sftp or scp
   HOST=exemple.com
   PORT=22
   USER=username
   PASSWORD=password
   LOCAL_DIR=C:/exemple/
   REMOTE_DIR=remote-folder
   USE_GITIGNORE=true
   RETRY_ATTEMPTS=3
   RETRY_DELAY=5000 
   CONNECTION_TIMEOUT=30000
   ```

## Usage

Run the application:
```bash
npm start
```

The application will:
- Monitor changes in the `LOCAL_DIR`.
- Sync changes to the `REMOTE_DIR` based on the specified connection type.

## How It Works
1. **Initialization:** Loads configuration from the `.env` file and tests the server connection.
2. **Change Detection:** Uses `chokidar` to monitor file changes.
3. **File Operations:** Handles file upload, deletion, and folder creation based on events.
4. **Notification:** Notifies the user of sync operations and errors.

import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
// Get the current file's directory path when using ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow; // Keep a global reference of the window object to prevent it from being garbage collected

// Create the browser window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400, height: 900,
        icon: path.join(__dirname, 'public/assets/favicon.ico'), // Use 'icon.ico' for Windows
        autoHideMenuBar: true, // Hide "Files, Edit, View etc..." bar
        webPreferences: {
            enableBlinkFeatures: "OverlayScrollbars,HTMLImports",
            webSecurity: false, // Allow local network access TODO: Only for development!
            // Separates Electron’s Node.js context from the renderer process, preventing global variable collisions
            contextIsolation: true,
            // Disables Node.js in the renderer process, ensuring operation in a pure browser-like context
            nodeIntegration: false,
        }
    });

    // Load the HTML file
    mainWindow.loadFile(__dirname+'/public/index.html').then(r => {
        // Open DevTools during development (comment out for production)
        mainWindow.webContents.openDevTools();
    });

    // Handle window being closed
    mainWindow.on('closed', () => {mainWindow = null;});

}

// Create window when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit the application when all windows are closed
app.on('window-all-closed', app.quit);
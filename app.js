import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';


// Get the current file's directory path when using ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep a global reference of the window object to prevent it from being garbage collected
let mainWindow;

// Create the browser window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400, height: 900,
        icon: path.join(__dirname, 'public/res/favicon.ico'), // Use 'icon.ico' for Windows
        autoHideMenuBar: true, // Hide "Files, Edit, View etc..." bar
        //frame: false,  // Hides the default window controls
        //titleBarStyle: 'hidden',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false, // Allow local network access (only for development!)
            enableBlinkFeatures: "OverlayScrollbars,HTMLImports",
            //contextIsolation: true, // Enable context isolation for security
            //nodeIntegration: false, // Prevent direct access to Node.js APIs from renderer
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
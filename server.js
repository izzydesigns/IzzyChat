import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from 'uuid';

const app = express(); app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server,{cors:{origin:["*"],methods:["GET","POST"]}});
const users = new Map();
const socketToClientMap = new Map(); // Maps socket IDs to client IDs
const PORT = process.env.PORT || 8080, TIMEOUT = 1000 * 10; // 60s before user is removed from list
const CHATHISTORY_LIMIT = 100; // Set to desired history limit
const DEBUG_MODE = true;
let lobbyHistory = [];
// TODO: Save list of every user who has ever connected to disk somewhere somehow

io.on('connection', (socket) => {

    let heartbeat = setInterval(() => {
        users.forEach((user, clientId) => {
            if (!user.connected && (new Date() - new Date(user.lastSeen)) > TIMEOUT) {
                // Delete inactive users after user has been disconnected for TIMEOUT milliseconds
                users.delete(clientId);
                console.log("Removed inactive user:", clientId);
                io.emit('users-updated', Array.from(users.values()));
                // TODO: Add all connected users to a separate user list & set user.connected to 'offline' (str not bool)
            }
        });
    }, TIMEOUT); // Heartbeat every TIMEOUT milliseconds

    socket.on('signal', ({ toClientId, data }) => {
        const targetUser = users.get(toClientId);
        if (targetUser && targetUser.connected) {
            io.to(targetUser.socketId).emit('signal', {
                fromClientId: socketToClientMap.get(socket.id), data
            });
        }
        if(DEBUG_MODE) console.log("Signal to:", toClientId, "Data:", data);
    });

    socket.on('user-connected', (userData) => {
        try {
            const getClientId = userData.clientId; // Generate or use existing client ID
            const existingUser = (users.get(getClientId) || {}); // Check for existing user

            // Update or create user record
            const userRecord = {
                ...existingUser, ...userData,
                clientId: getClientId, socketId: socket.id,
                connected: true, lastSeen: new Date().toISOString()
            };
            // Initialize new userRecord
            if(!userRecord.username)userRecord.username = "Anonymous";
            if(!userRecord.avatar)userRecord.avatar = "👤";
            if(!userRecord.status)userRecord.status = "Available";
            if(!userRecord.clientId)userRecord.clientId = uuidv4();

            // Update maps
            users.set(userRecord.clientId, userRecord);
            socketToClientMap.set(socket.id, userRecord.clientId);

            // Notify client and update all users
            if (!existingUser) io.emit('user-connected', userRecord.username);
            console.log("User "+(existingUser?'Rec':'C')+"onnected:", userRecord);
            socket.emit('client-id', userRecord.clientId);
            socket.emit('lobby-history', lobbyHistory);
            io.emit('users-updated', Array.from(users.values()));

        } catch (e) { console.error('User connection error:', e); }
    });

    socket.on('disconnect', () => {
        const clientId = socketToClientMap.get(socket.id);
        if (clientId) {
            const userRecord = users.get(clientId);
            if (userRecord) {
                // Only mark as disconnected if this is the most recent connection
                if (userRecord.socketId === socket.id) {
                    users.set(clientId, {
                        ...userRecord,
                        connected: false, lastSeen: new Date().toISOString()
                    });

                    // Notify client and update all users
                    console.log("User disconnected:", userRecord);
                    io.emit('user-disconnected', userRecord.username);
                    io.emit('users-updated', Array.from(users.values()));
                }
                // Clean up socket mapping
                socketToClientMap.delete(socket.id);
            }
        }
    });

    socket.on('user-update', (userData) => {
        const user = users.get(socketToClientMap.get(socket.id));
        if(DEBUG_MODE) console.log("User Update: ",userData);
        if (user) {
            const updatedUser = { ...user, ...userData };
            users.set(user.clientId, updatedUser);
            io.emit('users-updated', Array.from(users.values()));
        }
    });

    socket.on('lobby-message', (message) => {
        lobbyHistory.push(message);
        if(lobbyHistory.length > CHATHISTORY_LIMIT) lobbyHistory.shift();
        console.log("Lobby Message:", message);
        io.emit('lobby-message', message);
    });

    // For debugging socket events
    if(DEBUG_MODE) socket.onAny((...args) => console.log("Socket Event:",args));

});

server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port '+PORT);
    server.getConnections((r, s) => {console.log(r, s)});
});
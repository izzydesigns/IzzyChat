import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from 'uuid';
const app = express(); app.use(express.static('public'));
const server = http.createServer(app), io = new Server(server,{cors:{origin:["*"],methods:["GET","POST"]}});
const users = new Map(), socketToClient = new Map();
const PORT = process.env.PORT || 8080, TIMEOUT = 60, HEARTBEAT_INTERVAL = 1000 * 10;
const CHATHISTORY_LIMIT = 100, DEBUG_MODE = true;
const HEARTBEAT = setInterval(() => {
    users.forEach((user, clientId) => {
        let timeSinceLastSeen = Math.round((new Date() - new Date(user.lastSeen))/1000);
        if(DEBUG_MODE) console.log(user.username,"has not been seen in",timeSinceLastSeen,"seconds");
        if (!user.connected && timeSinceLastSeen > TIMEOUT) {
            if(DEBUG_MODE) console.log("Removed inactive user:", user.username);
            users.delete(clientId);
            io.emit('users-updated', Array.from(users.values()));
        }
    });
}, HEARTBEAT_INTERVAL); // Heartbeat every HEARTBEAT_INTERVAL milliseconds
let lobbyHistory = [];
io.on('connection', (socket) => {
    socket.on('signal', ({ toClientId, data }) => {
        const targetUser = users.get(toClientId);
        if (targetUser && targetUser.connected) {
            io.to(targetUser.socketId).emit('signal', {
                fromClientId: socketToClient.get(socket.id), data
            });
        }
        if(DEBUG_MODE) console.log("Signal to:", toClientId, "Data:", data);
    });
    socket.on('user-connected', (userData) => {
        try {
            const existingUser = userData.clientId ? users.get(userData.clientId) : false;
            const isReconnection = !!existingUser;
            if(DEBUG_MODE) console.log(`User ${isReconnection ? 'Rec' : 'C'}onnected:`, userData.username);
            const userRecord = {
                ...existingUser, ...userData, // Combine existingUser & userData, then override values
                clientId: existingUser?.clientId || userData.clientId || uuidv4(),
                socketId: socket.id, connected: true, lastSeen: new Date().toISOString(),
                status: existingUser?.status || userData.status || "New user",
            };
            // Update maps
            users.set(userRecord.clientId, userRecord);
            socketToClient.set(socket.id, userRecord.clientId);
            // Tell all clients about new user-connected & send newly assigned clientId
            if (!isReconnection) {
                if(DEBUG_MODE) console.log("Emitting Client Id:",userRecord.clientId);
                socket.emit('client-id', userRecord.clientId);
                io.emit('user-connected', userRecord.username);
            }
            socket.emit('lobby-history', lobbyHistory);
            io.emit('users-updated', Array.from(users.values()));
        } catch (e) { console.error('User connection error:', e); }
    });
    socket.on('disconnect', () => {
        const clientId = socketToClient.get(socket.id); if(!clientId) return;
        const userRecord = users.get(clientId); if(!userRecord) return;
        // Only mark as disconnected if this is the most recent connection
        if (userRecord.socketId === socket.id) {
            users.set(clientId, { ...userRecord, connected: false, lastSeen: new Date().toISOString() });
            if(DEBUG_MODE) console.log("User disconnected:", users.get(clientId));
            io.emit('user-disconnected', userRecord.username); // Notify clients of disconnect
            io.emit('users-updated', Array.from(users.values()));
        }
        socketToClient.delete(socket.id); // Clean up socket mapping
    });
    socket.on('user-update', (userData) => {
        const clientId = socketToClient.get(socket.id);
        const user = users.get(clientId); if(!user) return;
        if(DEBUG_MODE) console.log("User Update: ",userData);
        const updatedUser = { ...user, ...userData };
        // Update lobby history with new username
        lobbyHistory = lobbyHistory.map(msg => msg.clientId === clientId ? { ...msg, user: updatedUser.username } : msg );
        users.set(clientId, updatedUser); // Update user record
        io.emit('users-updated', Array.from(users.values()));
    });
    socket.on('lobby-message', (message) => {
        const clientId = socketToClient.get(socket.id);
        const messageWithClientId = { ...message, clientId };
        users.set(clientId, { ...users.get(clientId), lastSeen: new Date().toISOString() });
        lobbyHistory.push(messageWithClientId);
        if(lobbyHistory.length > CHATHISTORY_LIMIT) lobbyHistory.shift();
        io.emit('lobby-message', message);
    });
    socket.on('user-command', (data) => { if(DEBUG_MODE) console.log("User command:", data); /*io.emit('user-command',data);*/ });
    if(DEBUG_MODE) socket.onAny((...args) => console.log("Socket Event:",args));
});
server.listen(PORT, '0.0.0.0');
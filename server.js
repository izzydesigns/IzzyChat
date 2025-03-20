import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from 'uuid';

const app = express(); app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: [ "*" ], methods: ["GET", "POST"] }
});
const users = new Map();
const socketToClientMap = new Map(); // Maps socket IDs to client IDs
const PORT = process.env.PORT || 8080;

io.on('connection', (socket) => {

    // For debugging socket events
    /*socket.onAny((...args) => {
        io.emit('users-updated', Array.from(users.values()), args);
        console.log("Socket Event: ",args);
    });*/

    socket.on('signal', ({ toClientId, data }) => {
        const targetUser = users.get(toClientId);
        if (targetUser && targetUser.connected) {
            io.to(targetUser.socketId).emit('signal', {
                fromClientId: socketToClientMap.get(socket.id), data
            });
        }
    });

    socket.on('lobby-message', (message) => {
        io.emit('lobby-message', message);
    });

    socket.on('user-connected', (userData) => {
        try {
            const getClientId = userData.clientId; // Generate or use existing client ID
            const existingUser = users.get(getClientId); // Check for existing user

            // Update or create user record
            const userRecord = {
                ...(existingUser || {}), ...userData,
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
            socket.emit('client-id', userRecord.clientId);
            io.emit('user-connected', userRecord.username);
            io.emit('users-updated', Array.from(users.values()));

        } catch (e) { console.error('User connection error:', e); }
    });

    socket.on('disconnect', () => {
        const clientId = socketToClientMap.get(socket.id);
        if (clientId) {
            const user = users.get(clientId);
            if (user) {
                // Only mark as disconnected if this is the most recent connection
                if (user.socketId === socket.id) {
                    users.set(clientId, {
                        ...user,
                        connected: false, lastSeen: new Date().toISOString()
                    });

                    io.emit('user-disconnected', user.username);
                    io.emit('users-updated', Array.from(users.values()));
                }
                // Clean up socket mapping
                socketToClientMap.delete(socket.id);
            }
        }
    });

    socket.on('heartbeat', () => {
        // Add periodic cleanup
        const now = new Date(), timeout = 1000 * 60; // 60 seconds
        users.forEach((user, clientId) => {
            if(!user.clientId || user.clientId === "pending") user.clientId = uuidv4();
            if (!user.connected && now - new Date(user.lastSeen) > timeout) {
                users.delete(clientId);
                console.log(`Removed inactive user: ${clientId}`);
            }
        });
        io.emit('users-updated', Array.from(users.values()));
    });

});

server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port '+PORT);
    server.getConnections((r, s) => {console.log(r, s)});
});
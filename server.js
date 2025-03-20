import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from 'uuid';

const app = express(); app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:3000",      // Local development
            "https://yourdomain.com",     // Production domain
            "https://www.yourdomain.com"  // Alternate domain
        ],
        methods: ["GET", "POST"]
    }
});
const users = new Map();
const socketToClientMap = new Map(); // Maps socket IDs to client IDs
const debugging = true;

io.on('connection', (socket) => {

    // For debugging socket events
    //socket.onAny((...args) => {io.emit('users-updated', Array.from(users.values()), args);});

    socket.on('signal', ({ toClientId, data }) => {
        const targetUser = users.get(toClientId);
        if (targetUser && targetUser.connected) {
            io.to(targetUser.socketId).emit('signal', {
                fromClientId: socketToClientMap.get(socket.id),
                data
            });
        }
    });

    socket.on('lobby-message', (message) => {
        io.emit('lobby-message', message);
    });

    socket.on('user-connected', (userData) => {
        console.log("USER CONNECT: ", userData);
        try {
            // Generate or use existing client ID
            const clientId = userData.clientId || uuidv4();

            // Check for existing user
            const existingUser = users.get(clientId);

            // Update or create user record
            const userRecord = {
                ...(existingUser || {}), // Preserve existing data if any
                ...userData,
                clientId,
                socketId: socket.id,
                connected: true,
                lastSeen: new Date().toISOString()
            };

            // Update maps
            users.set(clientId, userRecord);
            socketToClientMap.set(socket.id, clientId);

            console.log("USERS MAP:", Array.from(users.values()));

            // Notify client and update all users
            socket.emit('client-id', clientId);
            io.emit('user-connected', userRecord.username);
            io.emit('users-updated', Array.from(users.values()));

        } catch (e) {
            console.error('User connection error:', e);
        }
    });

    socket.on('disconnect', () => {
        const clientId = socketToClientMap.get(socket.id);
        if (clientId) {
            const user = users.get(clientId);
            console.log("USER DISCONNECT: ", user);

            if (user) {
                // Only mark as disconnected if this is the most recent connection
                if (user.socketId === socket.id) {
                    users.set(clientId, {
                        ...user,
                        connected: false,
                        lastSeen: new Date().toISOString()
                    });

                    io.emit('user-disconnected', user.username);
                    io.emit('users-updated', Array.from(users.values()));
                }

                // Clean up socket mapping
                socketToClientMap.delete(socket.id);
            }

            console.log("USERS MAP AFTER DISCONNECT:", Array.from(users.values()));
        }
    });

    socket.on('heartbeat', () => {
        // Add periodic cleanup
        const now = new Date(), timeout = 1000 * 60; // 60 seconds

        users.forEach((user, clientId) => {
            if (!user.connected && now - new Date(user.lastSeen) > timeout) {
                users.delete(clientId);
                console.log(`Removed inactive user: ${clientId}`);
            }
        });
        io.emit('users-updated', Array.from(users.values()));
    });

});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
    server.getConnections((r, s) => {console.log(r, s)});
});
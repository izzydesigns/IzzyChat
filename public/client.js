let socket, heartbeat;
let offlineOverlay = document.getElementById('offline-overlay');
let currentTab = 'lobby';
let peerConnections = {}, dataChannels = {};
let userSettings = JSON.parse(localStorage.getItem('userSettings'));
let clientId = localStorage.getItem('clientId') || undefined;
let usersMap = new Map();
let RTCconfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" },], // Fallback public STUN server, updated by `setupICE()`
    iceTransportPolicy: 'all', // Allow both UDP and TCP
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
};
let connectionAttempts = 0;
const MAX_RETRIES = 5;
const TIMEOUT = 5000;

async function initialize() {
    await setupICE();
    let windowURL = window.location.hostname;
    const serverUrl = (windowURL === 'localhost' || windowURL === '') ? 'http://localhost:8080' : window.location.origin;
    socket = io(serverUrl, {transports: ['websocket'],reconnectionAttempts: MAX_RETRIES,timeout: TIMEOUT});
    socket.on('connect', () => {
        connectionAttempts = 0;
        setupSocketListeners();
        setupEventListeners();
        setupChatWindow();
        console.log('Connected to server');
        // Notify server about user connection
        socket.emit('user-connected', { ...userSettings, clientId: clientId });
        // Hide disconnected overlay
        document.getElementsByClassName("disconnected-text")[0].textContent = "Disconnected. Attempting to reconnect...";
    });
    socket.on('reconnect_attempt', (attempt) => {
        connectionAttempts = attempt;
        console.log(`Reconnection attempt ${attempt}/${MAX_RETRIES}`);
        offlineOverlay.classList.remove("hidden");
    });
    socket.on('reconnect_failed', () => {
        console.error('Failed to reconnect to server');
        offlineOverlay.classList.remove("hidden");
    });
}

// For Open Relay Project's TURN server API
async function setupICE(){
    // Open Relay Project API Key: 00de2c5d67d0f9403ac3eb51b8b5cdc91f57
    // Calling the REST API TO fetch the TURN Server Credentials
    const response = await fetch("https://izzychat.metered.live/api/v1/turn/credentials?apiKey=00de2c5d67d0f9403ac3eb51b8b5cdc91f57");
    // Using the iceServers array in the RTCPeerConnection method
    RTCconfig.iceServers = await response.json();
}

// Settings Management
function loadSettings() {
    if(!userSettings) {
        userSettings = {
            username: 'Anonymous',
            avatar: '👤',
            status: 'Available'
        };
        console.log("SAVING USER SETTINGS FOR FIRST TIME", userSettings);
        // Save first time default values into localstorage
        localStorage.setItem('userSettings', JSON.stringify(userSettings));
    }

    // Add clear chat button
    const clearButton = document.createElement('button');
    clearButton.textContent = 'Clear Chat History';
    clearButton.className = 'bg-red-600 px-4 py-2 rounded-lg mt-4';
    clearButton.onclick = () => {
        if (confirm('Clear all chat history?')) {
            clearChatHistory();
            Object.keys(dataChannels).forEach(id => clearChatHistory(id));
        }
    };
    document.getElementById('settings-form').appendChild(clearButton);

    document.getElementById('username-input').value = userSettings.username;
    document.getElementById('avatar-input').value = userSettings.avatar;
    document.getElementById('status-input').value = userSettings.status;
}
function saveSettings() {
    userSettings = {
        username: document.getElementById('username-input').value,
        avatar: document.getElementById('avatar-input').value,
        status: document.getElementById('status-input').value.slice(0, 32),
    };

    localStorage.setItem('userSettings', JSON.stringify(userSettings));
    localStorage.setItem('clientId', clientId);
    socket.emit('user-connected', { ...userSettings, clientId: clientId });
}
function toggleSettings() {document.getElementById('settings-modal').classList.toggle('hidden');}
function clearChatHistory(userId = 'lobby') {
    try {
        localStorage.removeItem(`chatHistory-${userId}`);
        const chatContainer = document.getElementById(`chat-${userId}`);
        if (chatContainer) chatContainer.innerHTML = '';
    } catch (e) { console.error('Error clearing chat history:', e); }
}
function assignClientId(data){
    if(clientId) { return; } // clientId already assigned
    clientId = data; localStorage.setItem('clientId', clientId);
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) toggleSettings();
    });

    document.getElementById('settings-form').addEventListener('submit', (e) => {
        e.preventDefault(); saveSettings(); toggleSettings();
    });
}
function setupSocketListeners() {
    socket.on('users-updated', updateOnlineUsers);
    socket.on('lobby-message', handleLobbyMessage);
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('user-connected', handleUserConnected);
    socket.on('signal', handleSignal);
    socket.on('client-id', assignClientId);
    socket.on('connect_error', (err) => {
        console.error('Connection error:', err);
        offlineOverlay.classList.remove("hidden");
    });
}
function setupDataChannel(clientId, dc) {
    dataChannels[clientId] = dc;
    console.log(`Setting up data channel with ${clientId}`);

    dc.onopen = () => {
        console.log(`Data channel opened with ${clientId}`);
        loadChatHistory(clientId);
    };

    dc.onmessage = (event) => { addMessageToTab(clientId, JSON.parse(event.data)); };

    dc.onerror = (e) => { console.error('Data channel error:', e); }
}

// Tab Management
function setupChatWindow() {
    document.getElementById('chat-container').innerHTML = '';
    createTab('lobby', 'Lobby', true);

    // Load lobby history after connection
    loadChatHistory('lobby');

    loadTabState(); // Load previous tabs as well
    // Load PM histories for existing tabs
    document.querySelectorAll('[data-tab]').forEach(tab => {
        const tabId = tab.dataset.tab;
        if (tabId !== 'lobby') loadChatHistory(tabId);
    });

    offlineOverlay.classList.add("hidden"); // We must be online, since this is only called inside socket.on('connect')
    loadSettings(); // Update Settings menu with data from userSettings value in localstorage
}
function createTab(id, label, isActive = false) {
    // Check if tab already exists
    const existingTab = document.querySelector(`[data-tab="${id}"]`);
    // If tab exists, just switch to it
    if (existingTab) { switchTab(id); return; }

    const tabsContainer = document.getElementById('tabs');
    const tab = document.createElement('button');
    tab.className = `px-4 py-2 rounded-t-lg ${isActive ? 'bg-gray-800' : 'bg-gray-700 hover:bg-gray-600'}`;
    tab.textContent = label; tab.dataset.tab = id;

    // Create onclick handler for each tab & switch to it on click
    tab.onclick = () => switchTab(id);

    // Create right click handler & close the tab upon click
    tab.oncontextmenu = (e) => {
        e.preventDefault();
        if (id !== 'lobby') { // Ignore lobby tab
            // Clean up WebRTC connection if it exists
            if (peerConnections[id]) {
                peerConnections[id].close();
                delete peerConnections[id];
            }
            tab.remove();
            document.getElementById(`chat-${id}`).remove();
            if (currentTab === id) switchTab('lobby'); // Switch to lobby when deleting a chat tab
            saveTabState();
        }
    };

    tabsContainer.appendChild(tab);

    const chatDiv = document.createElement('div');
    chatDiv.id = `chat-${id}`; chatDiv.className = 'overflow-y-auto h-full';
    chatDiv.style.display = isActive ? 'block' : 'none';// unnecessary?
    document.getElementById('chat-container').appendChild(chatDiv);

    if (isActive) currentTab = id;
    if(id !== 'lobby')saveTabState();
}
function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('#tabs button').forEach(btn => {
        btn.className = btn.dataset.tab === tabId ?
            'px-4 py-2 rounded-t-lg bg-gray-800' :
            'px-4 py-2 rounded-t-lg bg-gray-700 hover:bg-gray-600';
    });
    document.querySelectorAll('#chat-container > div').forEach(div => {
        div.style.display = (div.id === `chat-${tabId}`)?'block':'none';
    });
}
function addMessageToTab(tabId, message) {
    if (!document.getElementById(`chat-${tabId}`)) {
        createTab(tabId, `PM: ${message.from}`);
    }
    const chatContainer = document.getElementById(`chat-${tabId}`);
    if (chatContainer) {
        const messageElement = document.createElement('div');
        let msgSanitized = sanitizeString(message.message);
        let userSanitized = sanitizeString(message.from);
        messageElement.className = 'mb-2';
        messageElement.innerHTML = `
        <span class="timestamp text-gray-400">[${new Date(message.timestamp).toLocaleTimeString()}]</span>
        <strong class="username"></strong><span class="message"></span>`;

        chatContainer.appendChild(messageElement);
        chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll to bottom automatically

        if (tabId !== 'lobby' || message.from !== 'System') { // Lobby msg saving handled in handleLobbyMessage function
            let msg = {...message, user: message.from};
            msg.from = undefined;
            saveChatHistory(tabId, msg);
        }

        if(currentTab !== tabId)chatContainer.hidden = true; // Hide other chat windows if they're not the current tab
        messageElement.querySelector(".username").textContent = userSanitized + ": ";
        messageElement.querySelector(".message").textContent = msgSanitized;
    }
}
// Add tab persistence
function saveTabState() {
    const tabs = Array.from(document.querySelectorAll('#tabs button'))
        .map(btn => ({
            id: btn.dataset.tab,
            label: btn.textContent
        }));
    localStorage.setItem('chatTabs', JSON.stringify(tabs));
}
function loadTabState() {
    const savedTabs = JSON.parse(localStorage.getItem('chatTabs')) || [];
    savedTabs.forEach(tab => {
        if (tab.id !== 'lobby' && !document.querySelector(`[data-tab="${tab.id}"]`)) {
            createTab(tab.id, tab.label);
        }
    });
}

// User List Management
function updateOnlineUsers(users = undefined) {
    usersMap = new Map(users?.map(user => [user.clientId, user]));
    const container = document.getElementById('online-users');
    container.innerHTML = users.map(user => `
      <div class="flex items-center p-2 hover:bg-gray-700 rounded cursor-pointer"
           onclick="startPM('${user.clientId}')"
           title="User ID: ${user.clientId}\nClick to start private chat">
        <span class="text-2xl mr-2">${user.avatar}</span>
        <div class="flex flex-col">
          <div>${user.username}</div>
          <div class="text-gray-400 text-sm">${user.status}</div>
          <span class="${user.connected ? 'text-green-500' : 'text-red-500'} text-sm block">
            ${user.connected ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>
    `).join('');
}

// Message & WebRTC Handlers
async function handleCandidate(from, data) {
    const pc = peerConnections[from];
    if (!pc || !data.candidate) return;

    try {
        // Validate required candidate fields
        const candidateData = {
            candidate: data.candidate.candidate,
            sdpMid: data.candidate.sdpMid || '0',
            sdpMLineIndex: data.candidate.sdpMLineIndex ?? 0,
            usernameFragment: data.candidate.usernameFragment || ''
        };

        // Validate candidate format
        if (!candidateData.candidate.includes('typ')) {
            console.warn('Invalid candidate format:', candidateData);
            return;
        }

        await pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (e) {
        console.error('ICE candidate error:', e);
    }
}
async function handleAnswer(from, answer) {
    const pc = peerConnections[from];
    if (pc) {
        try {
            pc.onicecandidate = (event) => { // I think this goes here?
                if (event.candidate) {
                    socket.emit('signal', {
                        toClientId: from,  // or 'from' in handleOffer case
                        data: {
                            type: 'candidate',
                            candidate: {
                                candidate: event.candidate.candidate,
                                sdpMid: event.candidate.sdpMid || '0', // Default to '0' if missing
                                sdpMLineIndex: event.candidate.sdpMLineIndex || 0,
                                usernameFragment: event.candidate.usernameFragment
                            }
                        }
                    });
                }
            };
            pc.oniceconnectionstatechange = () => {
                if (pc.iceConnectionState === 'failed') pc.restartIce();
            };
            await pc.setRemoteDescription(answer);
            // Check if we need to create tab here
            if (!document.querySelector(`[data-tab="${from}"]`)) {
                const user = usersMap.get(from);
                createTab(from, `PM: ${user?.username}`);
            }
        } catch (e) { console.error('Answer handling error:', e); }
    }
}
async function handleOffer(fromClientId, offer) {
    const pc = new RTCPeerConnection(RTCconfig);
    peerConnections[fromClientId] = pc;

    // Create data channel immediately for responder
    const dc = pc.createDataChannel('chat', {
        negotiated: true,
        id: 0
    });
    setupDataChannel(fromClientId, dc);

    // Create tab for incoming PM
    const user = usersMap.get(fromClientId);
    createTab(fromClientId, `PM: ${user?.username}`);

    pc.ondatachannel = (event) => {
        const dc = event.channel;
        setupDataChannel(fromClientId, dc);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', {
                toClientId: fromClientId,  // or 'from' in handleOffer case
                data: {
                    type: 'candidate',
                    candidate: {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid || '0', // Default to '0' if missing
                        sdpMLineIndex: event.candidate.sdpMLineIndex || 0,
                        usernameFragment: event.candidate.usernameFragment
                    }
                }
            });
        }
    };

    // Add error handling
    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') pc.restartIce();
    };

    try {
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('signal', { toClientId: fromClientId, data: answer });
        monitorConnection(pc);
    } catch (e) { console.error('Offer handling error:', e); }
}
function handleLobbyMessage(message) {// Save lobby messages
    if (message.user !== 'System') saveChatHistory('lobby', message);
    const chatContainer = document.getElementById('chat-lobby');
    const messageElement = document.createElement('div');
    let msgSanitized = sanitizeString(message.message);
    let userSanitized = sanitizeString(message.user);
    messageElement.className = 'mb-2';
    messageElement.innerHTML = `
    <span class="timestamp text-gray-400">[${new Date(message.timestamp).toLocaleTimeString()}]</span>
    <strong class="username"></strong><span class="message"></span>`;
    chatContainer.appendChild(messageElement);
    messageElement.querySelector(".username").textContent = userSanitized + ": ";
    messageElement.querySelector(".message").textContent = msgSanitized;
    chatContainer.scrollTop = chatContainer.scrollHeight;
}
function handleUserConnected(username) {
    handleLobbyMessage({
        user: 'System',
        message: username === userSettings.username?"Connected!":username+" is now online.",
        timestamp: new Date().toISOString()
    });
}
function handleUserDisconnected(username) {
    handleLobbyMessage({
        user: 'System',
        message: `${username} is now offline`,
        timestamp: new Date().toISOString()
    });
}
async function handleSignal({ fromClientId, data }) {
    try {
        if (data.type === 'offer') { await handleOffer(fromClientId, data);
        } else if (data.type === 'answer') { await handleAnswer(fromClientId, data);
        } else if (data.type === 'candidate') { await handleCandidate(fromClientId, data); }
    } catch (e) { console.error('Signal handling error:', e); }
}
function monitorConnection(pc) {
    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
}

// Chat Message & Persistence Handlers
function saveChatHistory(userId, message) {
    try {
        // Get existing history or initialize new array
        const history = JSON.parse(localStorage.getItem(`chatHistory-${userId}`)) || [];

        // Add new message with timestamp
        history.push({
            ...message,
            timestamp: new Date().toISOString()
        });

        // Save back to localStorage
        localStorage.setItem(`chatHistory-${userId}`, JSON.stringify(history));

        // Optional: Limit history size
        if (history.length > 1000) { // Keep last 1000 messages
            localStorage.setItem(
                `chatHistory-${userId}`,
                JSON.stringify(history.slice(-1000))
            );
        }
    } catch (e) {
        console.error('Error saving chat history:', e);
    }
}
function loadChatHistory(userId) {
    try {
        const history = JSON.parse(localStorage.getItem(`chatHistory-${userId}`)) || [];

        // Ensure chat container exists
        let chatContainer = document.getElementById(`chat-${userId}`);
        if (!chatContainer) {
            // Create container if it doesn't exist
            chatContainer = document.createElement('div');
            chatContainer.id = `chat-${userId}`;
            chatContainer.className = 'overflow-y-auto h-full';
            document.getElementById('chat-container').appendChild(chatContainer);
        }

        // Clear existing messages
        chatContainer.innerHTML = '';

        // Display messages
        history.forEach(message => {
            const messageElement = document.createElement('div');
            messageElement.className = 'mb-2';
            messageElement.innerHTML = `
                <span class="text-gray-400">[${new Date(message.timestamp).toLocaleTimeString()}]</span>
                <strong>${message.user}:</strong> ${message.message}
            `;
            chatContainer.appendChild(messageElement);
        });

        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;

    } catch (e) {
        console.error('Error loading chat history:', e);
    }
}
async function startPM(targetClientId) {
    if (!targetClientId || targetClientId === clientId) return;
    // Check if tab already exists
    if (document.querySelector(`[data-tab="${targetClientId}"]`)) {
        switchTab(targetClientId);
        return;
    }

    // Get user info for tab label
    const user = Array.from(usersMap.values()).find(u => u.clientId === targetClientId);
    const tabLabel = `PM: ${user?.username}`;

    // Create tab before initiating connection
    createTab(targetClientId, tabLabel);

    const pc = new RTCPeerConnection(RTCconfig);
    peerConnections[targetClientId] = pc;

    const dc = pc.createDataChannel('chat', {
        negotiated: true,
        id: 0 // Force same ID on both ends
    });
    setupDataChannel(targetClientId, dc);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { toClientId: targetClientId, data: {type: 'candidate',candidate: event.candidate}});
        }
    };

    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
        });
        await pc.setLocalDescription(offer);
        socket.emit('signal', { toClientId: targetClientId, data: offer });
        monitorConnection(pc);
    } catch (e) {console.error('Offer creation error:', e);}

}
function sendMessage() {
    const message = sanitizeString(document.getElementById('message-input').value.trim());
    if (!message) return;

    if (currentTab === 'lobby') {
        socket.emit('lobby-message', {
            user: userSettings.username,
            message,
            timestamp: new Date().toISOString()
        });
    } else {
        const dc = dataChannels[currentTab];
        if (!dc) {
            console.error('No data channel for', currentTab);
            return;
        }
        const messageObj = {
            from: userSettings.username,
            message,
            timestamp: new Date().toISOString()
        };

        // Wait for channel to open
        if (dc.readyState !== 'open') {
            console.log('Queueing message until channel opens');
            dc.onopen = () => {
                dc.send(JSON.stringify(messageObj));
                addMessageToTab(currentTab, messageObj);
                dc.onopen = null; // Remove temporary handler
            };
            return;
        }else{
            dc.send(JSON.stringify(messageObj));
            addMessageToTab(currentTab, messageObj);
        }
    }
    document.getElementById('message-input').value = ''; // Clear input textbox
}
function sanitizeString(str) {
    let stringParse = str.replace(/[&<>"'`]/g,
        (match) => {
            return {
                //'&': '&amp;',
                '<': '<​', // TODO: uses zero width joiner... sanitize this better...
                '>': '>​',
                //'"': '&quot;',
                //"'": '&#39;',
                //'`': '&#96;'
            }[match]
        });
    return str;// TODO: handle parsing later, this does nothing right now
}

initialize().then(() => {
    if(heartbeat) return;
    heartbeat = setInterval(() => {
        if(!socket.connected) {
            offlineOverlay.classList.remove("hidden");
            clearInterval(heartbeat);
            //window.location.reload();
            return;
        }
        socket.emit('heartbeat', userSettings.username, clientId);
    }, 10000);
});
let socket, usersMap = new Map(), peerConnections = {}, peerConnectionStates = {}, dataChannels = {};
let offlineOverlay = document.getElementById('offline-overlay');
let settingsElem = document.getElementById('settings-modal');
let currentTab, windowTitle, config, userSettings, clientId;
let RTCconfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" },], // Fallback public STUN server, updated by `setupICE()`
    iceTransportPolicy: 'all', // Allow both UDP and TCP
    bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require'
};
let RETRIES = 0, FIRST_CONNECT = true;
// Change these variables to whatever you'd like
const DEBUG = { networking: false, tabs: false, messages: false, localStorage: false };
const MAX_RETRIES = 5, TIMEOUT = 5000, CONFIG_PATH = "config.json", COMMAND_TRIGGER = "/";

async function initialize() {
    await loadConfig(CONFIG_PATH);

    // Initialize socket.io server
    const serverUrl = (window.location.hostname === 'localhost' || window.location.hostname === '') ? 'http://localhost:8080' : window.location.origin;
    const curUserElem = document.querySelector(".current-user-online");
    const disconnectedTextElem = document.querySelector(".disconnected-text");
    socket = io(serverUrl, {transports: ['websocket'],reconnectionAttempts: MAX_RETRIES,timeout: TIMEOUT});
    socket.on('connect', () => { RETRIES = 0;
        if(FIRST_CONNECT){ FIRST_CONNECT = false; // Successfully connected for the first time
            setupSocketListeners(); setupEventListeners(); loadSettings(); loadTabState();
            // Update original "Connecting..." text to "Disconnected." once a connection has been made
            disconnectedTextElem.textContent = "Disconnected. Attempting to reconnect...";
            curUserElem.textContent = "Online";
            curUserElem.classList.remove('text-red-500'); curUserElem.classList.add('text-green-500');
        }
        // Notify server about user connection
        socket.emit('user-connected', { ...userSettings, clientId: clientId.length>0?clientId:undefined });
        if(DEBUG.networking) console.log('[Socket] Connected to server successfully!');
        offlineOverlay.classList.add("hidden"); // Hide disconnected overlay
    });
    socket.on('connect_error', (err) => {
        if(DEBUG.networking) console.log('[Socket] Connection error: ',err);
        offlineOverlay.classList.remove("hidden");
        curUserElem.textContent = "Offline";
        curUserElem.classList.remove('text-green-500');
        curUserElem.classList.add('text-red-500');
    });
}
async function loadConfig(path){
    const getConfig = await fetch(path);
    config = await getConfig.json(); // Load config.json data into config variable
    document.querySelector('.title-bar-area > .title').innerHTML = config.projectName;
    windowTitle = config.projectName+" - ";//+" v"+config.version;
    // Get userSettings from localStorage, otherwise generate new data
    userSettings = getLocalStorage('userSettings', []);
    // No userSettings found in localStorage? Generate new settings & save them to localStorage
    if(userSettings.length <= 0) userSettings = generateNewUser(); setLocalStorage('userSettings', userSettings);
    clientId = getLocalStorage('clientId', []);
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage(); // Detect enter keypress
    });
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) { loadSettings(); toggleSettings(); }
    });
    document.getElementById('settings-form').addEventListener('submit', (e) => {
        e.preventDefault(); // Prevent form submission from refreshing page
    });
}
function setupSocketListeners() {
    socket.on('users-updated', updateOnlineUsers);
    socket.on('lobby-message', handleLobbyMessage);
    socket.on('lobby-history', handleLobbyHistory);
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('user-connected', handleUserConnected);
    socket.on('signal', handleSignal);
    socket.on('client-id', assignClientId);
    socket.on('reconnect_failed', () => {offlineOverlay.classList.remove("hidden");});
    socket.on('reconnect_attempt', (attempt) => { RETRIES = attempt; offlineOverlay.classList.remove("hidden"); });
}
function setupDataChannel(clientId, dc) {
    dataChannels[clientId] = dc;
    if(DEBUG.networking) console.log(`[WebRTC] Setting up data channel with ${clientId}`);
    dc.onopen = () => {
        if(DEBUG.networking) console.log(`[WebRTC] Data channel opened with ${clientId}`);
        loadChatHistory(clientId);
    };
    dc.onclose = () => {
        if(DEBUG.networking) console.log(`[WebRTC] Data channel closed with ${clientId}`);
        delete dataChannels[clientId];
    };
    dc.onmessage = (event) => {
        // TODO: Handle other data.type and data.actions, not just messages (like incoming voice chats or PM requests?)
        if(DEBUG.networking) console.log(`[WebRTC] Re-established! (with: ${currentTab})`);
        addMessageToTab(clientId, JSON.parse(event.data));
    };
}
function assignClientId(data) { clientId = data; setLocalStorage('clientId', data); }

// Settings Management
function generateNewUser() {
    const defaults = config.defaultSettings; if(!defaults) return;
    const randNames = defaults.usernames, randAvatars = defaults.avatars, randStatuses = defaults.statuses;
    return { // Retrieves random username, avatar, and status from config.json defaultSettings values
        username: randNames[Math.floor(Math.random() * randNames.length)],
        avatar: randAvatars[Math.floor(Math.random() * randAvatars.length)],
        status: randStatuses[Math.floor(Math.random() * randStatuses.length)]
    };
}
function loadSettings(settings = userSettings) {
    // If no userSettings value retrieved from localStorage,
    if(!settings) { userSettings = generateNewUser(); setLocalStorage('userSettings',userSettings); return; }
    document.getElementById('username-input').value = settings.username;
    document.getElementById('avatar-input').value = settings.avatar;
    document.getElementById('status-input').value = settings.status;
}
function saveSettings() {
    const oldUsername = userSettings.username;
    const newSettings = {
        username: document.getElementById('username-input').value,
        avatar: document.getElementById('avatar-input').value,
        status: document.getElementById('status-input').value
    };
    if (JSON.stringify(newSettings) !== JSON.stringify(userSettings)) {
        userSettings = newSettings;
        socket.emit('user-update', userSettings);
        setLocalStorage('userSettings', userSettings);
        updateCurrentUserDisplay();
        if (oldUsername !== userSettings.username) { // Handle username updates
            updateChatHistoryUsernames(oldUsername, userSettings.username);
            // Reload all chat histories for every tab to update usernames
            document.querySelectorAll('[data-tab]').forEach(tab => loadChatHistory(tab.dataset.tab));
        }
    }
}
function toggleSettings() {document.getElementById('settings-modal').classList.toggle('hidden');}

// Tab Management
function createTab(id, label, isActive = false) {
    // Check if tab already exists
    const existingTab = document.querySelector(`[data-tab="${id}"]`);
    if (existingTab) {
        if (isActive && currentTab !== id) switchTab(id);
        if(DEBUG.tabs) console.log(`[Tab] Tab ${id} already exists`);
        return;
    }
    if(DEBUG.tabs) console.log(`[Tab] Creating new tab named '${id}'`);
    const tab = document.createElement('button');
    const tabsContainer = document.getElementById('tabs');
    // If isActive is true, find other buttons with 'bg-gray-800' and replace with 'bg-gray-700' and 'hover:bg-gray-600'
    if (isActive) {
        tabsContainer.querySelectorAll('button.bg-gray-800').forEach(btn => {
            btn.classList.remove('bg-gray-800'); btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
        });
    }
    tab.className = `px-8 py-2 text-2xl rounded-t-lg ${isActive ? 'bg-gray-800' : 'bg-gray-700 hover:bg-gray-600'}`;
    tab.textContent = label; tab.dataset.tab = id;
    // Create onclick handler for each tab & switch tabs
    tab.onclick = () => switchTab(id);
    // Create right click handler & close the tab upon click
    tab.oncontextmenu = (e) => {
        e.preventDefault();
        if (id !== 'lobby') {
            if(DEBUG.tabs) console.log(`[Tab] Closing PM tab with ${id}`);
            //cleanupConnection(id);
            tab.remove();
            if (currentTab === id) switchTab('lobby');
        }
    };
    tabsContainer.appendChild(tab);
    if (isActive) currentTab = id; // Set currentTab if new tab isActive
    // Create chat div for messages
    if(!document.getElementById(`chat-${id}`)) {
        const chatDiv = document.createElement('div');
        chatDiv.id = `chat-${id}`; chatDiv.className = 'overflow-y-auto h-full';
        document.getElementById('chat-container').appendChild(chatDiv);
    }
    // Display the chat-container div for currentTab
    document.querySelectorAll('#chat-container > div').forEach(div => {
        div.style.display = (div.id === `chat-${currentTab}`)?'block':'none';
    });
    saveTabState(); // Save new tab state (we save tab state when we call switchTab
    if(id === 'lobby') return; // Return if creating lobby tab, otherwise establish data channels
    const user = usersMap.get(id);
    // Check if user is online and if so, attempt connection
    if (user?.connected) establishDataChannel(id).then();
}
function switchTab(tabId) {
    if(DEBUG.tabs) console.log("[Tab] Switching tabs to",tabId);
    if (tabId === currentTab) { if(DEBUG.tabs) { console.log("[Tab] Already on tab", tabId); } return; }
    let tabName="Lobby"; // Default to 'Lobby'
    currentTab = tabId; saveTabState();
    // Assign classes depending on the 'data-tab' value (tabId matched? use different tailwind classes)
    document.querySelectorAll('#tabs button').forEach(btn => {
        btn.className = 'px-8 py-2 text-2xl rounded-t-lg ' +
            (btn.dataset.tab === tabId ? 'bg-gray-800' : 'bg-gray-700 hover:bg-gray-600');
        if(currentTab !== 'lobby') tabName = btn.textContent.substring(4); // Tab text, minus "PM: " text
    });
    // Display current chat tab's chat-container
    document.querySelectorAll('#chat-container > div').forEach(div => {
        div.style.display = (div.id === `chat-${currentTab}`)?'block':'none';
    });
    const curChat = document.getElementById('chat-'+currentTab); if(!curChat) return;
    requestAnimationFrame(() => curChat.scrollTop = curChat.scrollHeight); // Scroll to bottom of container automatically
}
function addMessageToTab(tabId, message) {
    if (!document.getElementById(`chat-${tabId}`)) {
        createTab(tabId, `PM: ${message.user}`); // If no tab exists, create one
    }
    const chatContainer = document.getElementById(`chat-${tabId}`); if(!chatContainer) return;
    addMessageTo(chatContainer, message);
    if(tabId !== 'lobby') saveChatHistory(tabId, message);
    if(currentTab !== tabId) chatContainer.hidden = true; // Ensures chat window is hidden if its not the currentTab
}
function saveTabState() {
    const tabs = Array.from(document.querySelectorAll('#tabs button'))
        .map(btn => ({ id: btn.dataset.tab, label: btn.textContent }));
    let tabName; tabs.forEach(tab => {if(tab.id === currentTab){tabName=tab.label;}});
    setLocalStorage('chatTabs', tabs); setLocalStorage('lastTab', currentTab);
    document.title = windowTitle + ((currentTab === 'lobby') ? 'Lobby' : tabName);
}
function loadTabState() {
    const savedTabs = getLocalStorage('chatTabs', [{id:'lobby',label:'Lobby'}]);
    currentTab = getLocalStorage('lastTab', 'lobby');
    let curTabName;
    savedTabs.forEach(tab => { // Create a tab for each savedTab value
        createTab(tab.id, tab.label, tab.id === currentTab);
        if(tab.id === currentTab) curTabName = tab.label;
    });
    document.querySelectorAll('[data-tab]').forEach(tab => {
        if (tab.dataset.tab !== 'lobby') loadChatHistory(tab.dataset.tab); // Load PM histories for existing tabs
    });
    document.title = windowTitle + ((currentTab === 'lobby') ? 'Lobby' : curTabName);
}

// User List Management
function handleUsernameChange(clientId, oldUsername, newUsername) {
    const pmTab = document.querySelector(`[data-tab="${clientId}"]`);
    if (pmTab) { pmTab.textContent = `PM: ${newUsername}`; saveTabState(); }
    updateChatHistoryUsernames(oldUsername, newUsername);
    // Force reload all affected chat histories
    document.querySelectorAll('[data-tab]').forEach(tab => {
        const tabId = tab.dataset.tab; loadChatHistory(tabId);
    });
}
function updateChatHistoryUsernames(oldName, newName) {
    // Update all chat history data (both lobby and PM localStorage data)
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('chatHistory-')) {
            const history = getLocalStorage(key, []);
            setLocalStorage(key, history.map(msg => {
                if (msg.user === oldName) { return {...msg, user: newName}; } return msg;
            }));
        }
    });
}
function updateOnlineUsers(users = []) {
    users.forEach(user => {
        const oldUser = usersMap.get(user.clientId);
        if (oldUser && oldUser.username !== user.username) {
            handleUsernameChange(user.clientId, oldUser.username, user.username);
            loadChatHistory(currentTab); // Update localStorage to new username & reload currentTab chat history
        }
    });
    usersMap = new Map(users?.map(user => [user.clientId, user]));
    const currentUser = users.find(user => user.clientId === clientId);
    if(currentUser) updateCurrentUserDisplay();
    const container = document.getElementById('online-users'); if(!container) return;
    container.innerHTML = ''; // Since we use innerHTML += to add each user, we reset it each new call
    users.sort((userA, userB) => { // Move current user to top of online users list
        if (userA.username === userSettings.username) return -1; // If userA = current user, place at top
        if (userB.username === userSettings.username) return 1; // If userB = current user, move userA down
        return 0;// Otherwise, maintain the current order
    });
    users.map((user) => {
        let isCurUser = user.username === userSettings.username;
        let usernameParsed = user.username.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
        container.innerHTML += `
            <div class="user-profile user-${usernameParsed} select-none break-words flex items-center p-2 hover:bg-gray-700 rounded-lg cursor-pointer"
                 onclick="${isCurUser ? 'toggleSettings()' : `startPM('${user.clientId}')`}">
                <span class="avatar text-2xl mr-2">${user.avatar}</span>
                <div class="flex flex-col w-0 flex-1">
                    <div class="username-area truncate"><div class="inline username truncate"></div><div class="text-gray-400 inline ${isCurUser?'block':'hidden'}"> (You)</div></div>
                    <div class="status text-gray-400 text-sm truncate"></div>
                    <span class="connection-status ${user.connected ? 'text-green-500' : 'text-red-500'} text-sm block">
                    ${user.connected ? 'Online' : 'Offline'}
                    </span>
                </div>
            </div>
        `;
        // Set tooltip text
        container.querySelector(".user-"+usernameParsed).title =
            (isCurUser ? ('Edit profile\nUser ID: '+user.clientId) :
                ('Click to start private chat\n\nStatus: '+user.status+
                '\nUser ID: '+user.clientId+'')
            );
        container.querySelector(".user-"+usernameParsed+" .username").textContent = user.username;
        container.querySelector(".user-"+usernameParsed+" .status").textContent = user.status;
    }).join('');
}
function updateCurrentUserDisplay() {
    document.getElementById('current-user-avatar').textContent = userSettings.avatar;
    document.getElementById('current-user-name').textContent =
        userSettings.username?.slice(0, 32);
    document.getElementById('current-user-status').textContent =
        userSettings.status?.slice(0, 32);
    let userListItem = document.querySelector(`.user-profile[title*="${clientId}"]`);
    if(!userListItem) return;
    userListItem.querySelector(".username").textContent = userSettings.username?.slice(0, 32);
    userListItem.querySelector(".avatar").textContent = userSettings.avatar;
    userListItem.querySelector(".status").textContent = userSettings.status?.slice(0, 32);
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
        if (!candidateData.candidate.includes('typ')) return;
        await pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (e) { /*console.error('ICE candidate error:', e); spams the console */ }
}
async function handleAnswer(from, answer) {
    if(DEBUG.networking) console.log(`[WebRTC] Handling answer from ${from}`);
    const pc = peerConnections[from]; if (!pc) return;
    try {
        pc.onicecandidate = (event) => { // I think this goes here?
            let candidate = event.candidate; if (!candidate) return;
            socket.emit('signal', {
                toClientId: from, data: { type: 'candidate', candidate: {
                    candidate: candidate.candidate, sdpMid: candidate.sdpMid || '0',
                    sdpMLineIndex: candidate.sdpMLineIndex || 0, usernameFragment: candidate.usernameFragment
                }}
            });
        };
        pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce(); };
        if(pc.status !== 'stable') await pc.setRemoteDescription(answer);
        // Check if we need to create new PM tab
        if (!document.querySelector(`[data-tab="${from}"]`)) startPM(from);
    } catch (e) { if(DEBUG.networking) console.error('[WebRTC] Error handling answer:', e); }
}
async function handleOffer(fromClientId, offer) {
    if(DEBUG.networking) console.log(`[WebRTC] Handling offer from ${fromClientId}`);
    const pc = new RTCPeerConnection(RTCconfig);
    peerConnections[fromClientId] = pc;
    // Create data channel immediately for responder
    const dc = pc.createDataChannel('chat', { negotiated: true, id: 0 });
    setupDataChannel(fromClientId, dc);
    // Create tab for incoming PM
    const user = usersMap.get(fromClientId);
    createTab(fromClientId, `PM: ${user?.username}`);
    // Handle data channel setup
    pc.ondatachannel = (event) => { setupDataChannel(fromClientId, event.channel); };
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const newCandidate = { type: 'candidate', candidate: {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid || '0', // Default to '0' if missing
                sdpMLineIndex: event.candidate.sdpMLineIndex || 0,
                usernameFragment: event.candidate.usernameFragment
            }};
            // Send ICE candidate offer + data
            socket.emit('signal', { toClientId: fromClientId, data: newCandidate });
            if(DEBUG.networking) console.log(`[Socket] Sending ICE candidate signal data to ${fromClientId}`);
        }
    };
    pc.oniceconnectionstatechange = () => {
        let state = pc.iceConnectionState;
        if (state === 'failed' || state === 'closed') pc.restartIce();
    };

    try {
        if(pc.connectionState !== 'closed'){
            await pc.setRemoteDescription(offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { toClientId: fromClientId, data: answer });
            if(DEBUG.networking) console.log(`[Socket] Sending answer signal data to ${fromClientId}`);
            monitorConnection(pc);
        }
    } catch (e) { if(DEBUG.networking) console.error('[WebRTC] Error handling offer:', e); }
}
function handleLobbyMessage(message) {// Save lobby messages
    addMessageTo(document.getElementById('chat-lobby'), message);
    saveChatHistory('lobby', message);
}
function handleLobbyHistory(history) {
    if(DEBUG.networking) console.log('[Socket] Received lobby chat history data!', history);
    history.forEach(msg => addMessageToTab('lobby', msg));
    setLocalStorage(`chatHistory-lobby`, history);
}
function handleUserConnected(username) {
    // Handles user-connected event TODO: Use this to reconnect PM datachannels & send pending messages
    /*handleLobbyMessage({
        user: 'System',
        message: username === userSettings.username?config.connectMsg:username+config.userConnectMsg,
        timestamp: new Date().toISOString()
    });*/
}
function handleUserDisconnected(username) {
    // Handles disconnect event TODO: Use this to disconnect PM datachannels & notify when messages are pending
    /*handleLobbyMessage({
        user: 'System', message: username+config.userDisconnectMsg,
        timestamp: new Date().toISOString()
    });*/
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
        let state = pc.iceConnectionState;
        if (state === 'failed' || state === 'closed') pc.restartIce();
    };
}
function cleanupConnection(clientId) {
    console.log(`[WebRTC] Cleaning up connection to ${clientId}`);
    // Cleanup peer connections, connection states, and data channel values for clientId
    if (peerConnections[clientId]) {
        peerConnections[clientId].close();
        delete peerConnections[clientId];
    }
    delete peerConnectionStates[clientId];
    delete dataChannels[clientId];
}
async function establishDataChannel(targetClientId, initiator = true) {
    if(DEBUG.networking) console.log(`[WebRTC] Establishing data channel with ${targetClientId} (initiator: ${initiator})`);
    if (!peerConnections[targetClientId]) { // Existing connection check
        const state = peerConnectionStates[targetClientId];
        if (state === 'connected' || state === 'connecting') {
            if(DEBUG.networking) console.log(`[WebRTC] Cleaning up existing '${state}' connection to ${targetClientId}`);
            cleanupConnection(targetClientId); // Cleanup stale connection
            return;
        }
    }
    const pc = new RTCPeerConnection(RTCconfig);
    peerConnections[targetClientId] = pc; peerConnectionStates[targetClientId] = 'new';
    pc.ondatachannel = (event) => {
        if(DEBUG.networking) console.log(`[WebRTC] Data channel received from ${targetClientId}`);
        setupDataChannel(targetClientId, event.channel);
    };
    pc.onconnectionstatechange = () => {
        if(DEBUG.networking) console.log(`[WebRTC] Connection state: ${pc.connectionState}`);
        peerConnectionStates[targetClientId] = pc.connectionState;
        if (pc.connectionState === 'disconnected') {
            if(DEBUG.networking) console.log(`[WebRTC] Attempting reconnection to ${targetClientId}`);
            setTimeout(() => establishDataChannel(targetClientId), TIMEOUT);
        }
    };
    pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        if(DEBUG.networking) console.log(`[WebRTC] Sending ICE candidate to ${targetClientId}`);
        socket.emit('signal', { toClientId: targetClientId, data: { type: 'candidate', candidate: event.candidate } });
    };
    try {
        if (initiator) {
            if(DEBUG.networking) console.log(`[WebRTC] Creating offer for ${targetClientId}`);
            const dc = pc.createDataChannel('chat', { negotiated: true, id: 0 });
            setupDataChannel(targetClientId, dc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('signal', { toClientId: targetClientId, data: offer });
            peerConnectionStates[targetClientId] = 'connecting';
        }
    } catch (e) { if(DEBUG.networking) console.error(`[WebRTC] Error establishing connection: ${e.message}`); }
}

// Helper functions for localStorage
function getLocalStorage(key, ifNoValFound) {
    const value = localStorage.getItem(key);
    if(DEBUG.localStorage) console.log(`[LocalStorage] Getting ${key}`);
    try {  return value !== null ? JSON.parse(value) : ifNoValFound; // Use backupVal if no localStorage value found
    } catch (e) {
        if(DEBUG.localStorage) console.log(`[LocalStorage] Non-JSON value for ${key}, returning alternate value`);
        return value !== null ? value : ifNoValFound; // Uses ifNoValFound if no localStorage value found
    }
}
function setLocalStorage(key, value) {
    // Automatically trim chat history arrays
    if (key.startsWith('chatHistory-') && Array.isArray(value)) {
        localStorage.setItem(key, JSON.stringify(value.slice(-99))); //key === 'chatHistory-lobby' ? 99 : 999;
    } else { localStorage.setItem(key, JSON.stringify(value)); } // Just set the item
    if(DEBUG.localStorage) console.log(`[LocalStorage] Setting ${key}`, value);
}

// Chat Message & Persistence Handlers
function clearChatHistory() {
    if (confirm('Clear all chat history?')) {
        Object.keys(localStorage).forEach((id) => {if(id.startsWith("chatHistory-"))localStorage.removeItem(id)});
        window.location.reload();
    }
}
function saveChatHistory(userId, message) {
    try {
        const history = getLocalStorage(`chatHistory-${userId}`, []);
        history.push({
            ...message, timestamp: new Date().toISOString(),
            clientId: userId === 'lobby' ? message.clientId : userId
        });
        setLocalStorage(`chatHistory-${userId}`, history);
    } catch (e) { console.error('Error saving chat history:', e); }
}
function loadChatHistory(userId) {
    const history = getLocalStorage(`chatHistory-${userId}`, []);
    let chatContainer = document.getElementById(`chat-${userId}`);
    if (!chatContainer) {
        chatContainer = document.createElement('div');
        chatContainer.id = `chat-${userId}`;
        chatContainer.className = 'overflow-y-auto h-full';
        console.log("LAODING CHAT HISTORY: IS CURRENT TAB?",userId,(userId !== currentTab), (userId !== currentTab)?'hidden':'');
        document.getElementById('chat-container').appendChild(chatContainer);
    }
    chatContainer.innerHTML = '';
    history.forEach(message => addMessageTo(chatContainer, message));
}
function startPM(targetClientId) {
    if (!targetClientId || targetClientId === clientId) { if(DEBUG.messages) {console.log("[PM] Invalid PM target");} return; }
    const existingTab = document.querySelector(`[data-tab="${targetClientId}"]`);
    if (existingTab) { if(DEBUG.messages) {console.log(`[PM] Switching to PM with ${targetClientId}`);} switchTab(targetClientId); return; }
    if(DEBUG.messages) console.log(`[PM] Starting new PM with ${targetClientId}`);
    createTab(targetClientId, `PM: ${usersMap.get(targetClientId)?.username}`, true);
}
function sendMessage() {
    const message = document.getElementById('message-input').value.trim(); if (!message) return;
    const messageObj = { user: userSettings.username, message, timestamp: new Date().toISOString() };
    document.getElementById('message-input').value = ''; // Clear input textbox
    if (currentTab === 'lobby') { // Handle lobby message
        switch(messageObj.message){
            case COMMAND_TRIGGER+'test':
                socket.emit('user-command', { clientId: clientId, command: 'test' });
                break;
            case COMMAND_TRIGGER+'help':
                socket.emit('user-command', { clientId: clientId, command: 'help' });
                break;
        }
        if(DEBUG.messages) console.log(`[Message] Sending message data to ${currentTab}`);
        socket.emit('lobby-message', messageObj);
    } else { // Handle PM messages
        let dc = dataChannels[currentTab];
        if (!dc || dc.readyState !== 'open') {
            // Check if user still exists and is connected, if not, return
            if(!usersMap.get(currentTab) || !usersMap.get(currentTab).connected) return;
            if(DEBUG.networking) console.log(`[WebRTC] Attempting to re-establish data channel with: ${currentTab}`);
            establishDataChannel(currentTab).then(() => {
                dc = dataChannels[currentTab];
                if (dc) {
                    dc.onopen = () => {
                        if(DEBUG.networking) console.log(`[WebRTC] Re-established! (with: ${currentTab})`);
                        dc.send(JSON.stringify(messageObj)); addMessageToTab(currentTab, messageObj);
                    };
                }
            });
        }else{
            if(DEBUG.messages && DEBUG.networking) console.log(`[Message/WebRTC] Sending message data to ${currentTab}`);
            dc.send(JSON.stringify(messageObj)); addMessageToTab(currentTab, messageObj);
        }
    }
}
function addMessageTo(container, message){
    if(!container || !message) return;
    const messageElement = document.createElement('div');
    messageElement.className = 'mb-2 text-2xl';// Adds 0.5rem margin to bottom
    messageElement.innerHTML = `
        <span class="timestamp text-gray-400">[${new Date(message.timestamp).toLocaleTimeString()}]</span>
        <strong class="username"></strong><span class="message"></span>`;
    container.appendChild(messageElement);
    messageElement.querySelector(".username").textContent = message.user; // Setting `textContent` sanitizes for us
    messageElement.querySelector(".message").textContent = ": "+message.message; // Setting `textContent` sanitizes for us
    requestAnimationFrame(() => container.scrollTop = container.scrollHeight); // Scroll to bottom of container automatically
}

// Initialize client.js now that all functions have been defined
initialize().then(() => { });
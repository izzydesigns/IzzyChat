let socket, heartbeat, config, windowTitle;
let peerConnections = {}, dataChannels = {};
let usersMap = new Map();
let clientId = localStorage.getItem('clientId') || undefined;
let userSettings = JSON.parse(localStorage.getItem('userSettings'));
let currentTab = localStorage.getItem('lastTab') || 'lobby';
let offlineOverlay = document.getElementById('offline-overlay');
let RTCconfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" },], // Fallback public STUN server, updated by `setupICE()`
    iceTransportPolicy: 'all', // Allow both UDP and TCP
    bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require'
};
let CONNECTION_ATTEMPTS = 0, FIRST_CONNECT = true;
const MAX_RETRIES = 5, TIMEOUT = 5000, HEARTBEAT = 10000;

async function initialize() {
    const getConfig = await fetch('res/config.json');
    config = await getConfig.json(); // Load config.json data into config variable
    windowTitle = '';//config.projectName+" - ";//+" v"+config.version;
    //await fetchICEServers(config.iceAPI_URL);// TODO: Use as backup

    let windowURL = window.location.hostname;
    const serverUrl = (windowURL === 'localhost' || windowURL === '') ? 'http://localhost:8080' : window.location.origin;

    socket = io(serverUrl, {transports: ['websocket'],reconnectionAttempts: MAX_RETRIES,timeout: TIMEOUT});

    socket.on('connect', () => {
        if(FIRST_CONNECT){
            setupSocketListeners(); setupEventListeners(); setupChatWindow();
            FIRST_CONNECT = false; // Successfully connected for the first time
        }
        console.log('Connected to server');
        // Notify server about user connection
        socket.emit('user-connected', { ...userSettings, clientId: clientId });
        CONNECTION_ATTEMPTS = 0;
        // Hide disconnected overlay
        offlineOverlay.classList.add("hidden");
        // Update disconnected text
        document.getElementsByClassName("disconnected-text")[0].textContent = "Disconnected. Attempting to reconnect...";
    });

    socket.on('reconnect_attempt', (attempt) => {
        CONNECTION_ATTEMPTS = attempt;
        offlineOverlay.classList.remove("hidden");
    });

    socket.on('reconnect_failed', () => {offlineOverlay.classList.remove("hidden");});
}
// For Open Relay Project REST API - fetch the TURN Server Credentials
async function fetchICEServers(apiUrl){
    const response = await fetch(apiUrl);
    RTCconfig.iceServers = await response.json();
}

// Settings Management
function loadSettings() {
    if(!userSettings) { // Was not found in localstorage
        userSettings = { username: 'Anonymous', avatar: '👤', status: 'Available' };
        // Initialize default values & save to localstorage
        localStorage.setItem('userSettings', JSON.stringify(userSettings));
    }
    document.getElementById('username-input').value = userSettings.username;
    document.getElementById('avatar-input').value = userSettings.avatar;
    document.getElementById('status-input').value = userSettings.status;
}
function saveSettings() {
    const userVal = sanitizeString(document.getElementById('username-input').value) || 'Anonymous';
    const avatarVal = sanitizeString(document.getElementById('avatar-input').value) || '👤';
    const statusVal = sanitizeString(document.getElementById('status-input').value) || 'Available';
    let unsavedChanges = false;
    if(userSettings.username !== userVal) { userSettings.username = userVal; unsavedChanges = true; }
    if(userSettings.avatar !== avatarVal) { userSettings.avatar = avatarVal; unsavedChanges = true; }
    if(userSettings.status !== statusVal) { userSettings.status = statusVal; unsavedChanges = true; }
    if(!unsavedChanges) return; // If there are no changes to be made, return
    localStorage.setItem('userSettings', JSON.stringify(userSettings)); // Save userSettings value
    localStorage.setItem('clientId', clientId); // Save clientId value
    updateCurrentUserDisplay(); // Update the user profile with new values
    socket.emit('user-update', userSettings); // Send user-update with new userSettings to update other clients
}
function toggleSettings() {document.getElementById('settings-modal').classList.toggle('hidden');}
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
    socket.on('lobby-history', (history) => {history.forEach(msg => addMessageToTab('lobby', msg))});
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('user-connected', handleUserConnected);
    socket.on('signal', handleSignal);
    socket.on('client-id', assignClientId);
    socket.on('heartbeat', assignClientId);
    socket.on('connect_error', () => {offlineOverlay.classList.remove("hidden");});
}
function setupDataChannel(clientId, dc) {
    dataChannels[clientId] = dc;
    //console.log(`Setting up data channel with ${clientId}`);
    dc.onopen = () => { loadChatHistory(clientId); };
    dc.onclose = () => { delete dataChannels[clientId]; };
    dc.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'system' && data.action === 'close-tab') {
            // Other user closed the tab
        } else { addMessageToTab(clientId, data); }
    };
}

// Tab Management
function setupChatWindow() {
    document.getElementById('chat-container').innerHTML = '';
    createTab('lobby', 'Lobby'); // Initialize Lobby tab
    loadTabState(); // Load previous tab state & set active window title as well
    loadSettings(); // Update Settings menu with data from userSettings value in localstorage
    updateCurrentUserDisplay(); // Update user profile after settings have been loaded

    // Load PM histories for existing tabs
    document.querySelectorAll('[data-tab]').forEach(tab => {
        const tabId = tab.dataset.tab;
        if (tabId !== 'lobby') loadChatHistory(tabId);
    });

    document.querySelector('.top-bar-area > .title').innerHTML = config.projectName;

}
function createTab(id, label, isActive = false, autoConnect = false) {
    // Check if tab already exists
    const existingTab = document.querySelector(`[data-tab="${id}"]`);
    if (existingTab) {
        if (autoConnect) establishDataChannel(id);
        switchTab(id); return;
    }

    const tab = document.createElement('button');
    const tabsContainer = document.getElementById('tabs');
    // If isActive is true, find other buttons with 'bg-gray-800' and replace with 'bg-gray-700' and 'hover:bg-gray-600'
    if (isActive) {
        tabsContainer.querySelectorAll('button.bg-gray-800').forEach(btn => {
            btn.classList.remove('bg-gray-800');
            btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
        });
    }
    tab.className = `px-4 py-2 rounded-t-lg ${isActive ? 'bg-gray-800' : 'bg-gray-700 hover:bg-gray-600'}`;
    tab.textContent = label;
    tab.dataset.tab = id;

    // Create onclick handler for each tab & switch to it on click
    tab.onclick = () => switchTab(id);

    // Create right click handler & close the tab upon click
    tab.oncontextmenu = (e) => {
        e.preventDefault();
        if (id !== 'lobby') {
            //if (dataChannels[id]) dataChannels[id].send(JSON.stringify({type:'system',action:'close-tab'})); // Send closure request
            //peerConnections[id]?.close();
            //delete peerConnections[id];
            //localStorage.removeItem(`chatHistory-${id}`);
            //document.getElementById(`chat-${id}`).innerHTML = '';
            tab.remove();
            if (currentTab === id) switchTab('lobby'); // Switch back to Lobby when deleting a tab
            saveTabState(); // Save tabs & update window title
        }
    };

    tabsContainer.appendChild(tab);
    if (isActive) currentTab = id; // Set currentTab if new tab isActive
    if(id !== 'lobby')saveTabState();

    // Create chat div for messages
    if(!document.getElementById(`chat-${id}`)) {
        const chatDiv = document.createElement('div');
        chatDiv.id = `chat-${id}`;
        chatDiv.className = 'overflow-y-auto h-full';
        document.getElementById('chat-container').appendChild(chatDiv);
    }
    document.querySelectorAll('#chat-container > div').forEach(div => {
        div.style.display = (div.id === `chat-${currentTab}`)?'block':'none';
    });

    if (autoConnect) {
        establishDataChannel(id);
    } else {
        // Check if user is online and attempt connection
        const user = usersMap.get(id);
        if (user?.connected) establishDataChannel(id);
    }

}
function switchTab(tabId) {
    let tabName="Lobby";
    currentTab = tabId;
    // Assign classes depending on the 'data-tab' value (tabId matched? use different tailwind classes)
    document.querySelectorAll('#tabs button').forEach(btn => {
        btn.className = 'px-4 py-2 rounded-t-lg ' +
            (btn.dataset.tab === tabId ? 'bg-gray-800' : 'bg-gray-700 hover:bg-gray-600');
        if(currentTab !== 'lobby') tabName = btn.textContent.substring(4); // Tab text, minus "PM: " text
    });
    // Display current chat tab's chat-container
    document.querySelectorAll('#chat-container > div').forEach(div => {
        div.style.display = (div.id === `chat-${currentTab}`)?'block':'none';
    });
    // Update 'chatTabs' + 'lastTab' localStorage values and window title
    saveTabState();
    const curChat = document.querySelector('#chat-'+currentTab);
    requestAnimationFrame(() => curChat.scrollTop = curChat.scrollHeight); // Scroll to bottom of container automatically
}
function addMessageToTab(tabId, message) {
    if (!document.getElementById(`chat-${tabId}`)) {
        createTab(tabId, `PM: ${message.user}`); // If no tab exists, create one
    }
    const chatContainer = document.getElementById(`chat-${tabId}`);
    if (chatContainer) {
        addMessageTo(chatContainer, message);
        // Handle PM message saving
        if (tabId !== 'lobby' || message.user !== 'System') {
            let msg = {...message, user: message.user};
            saveChatHistory(tabId, msg);
        }

        if(currentTab !== tabId)chatContainer.hidden = true; // Hide other chat windows if they're not the current tab
    }
}
function saveTabState() {
    const tabs = Array.from(document.querySelectorAll('#tabs button'))
        .map(btn => ({ id: btn.dataset.tab, label: btn.textContent }));
    localStorage.setItem('chatTabs', JSON.stringify(tabs));
    localStorage.setItem('lastTab', currentTab);
    let tabName;
    // Get tab.label of currentTab & update document.title
    tabs.forEach(tab => {if(tab.id === currentTab){tabName=tab.label;}});
    document.title = windowTitle + ((currentTab === 'lobby') ? 'Lobby' : tabName);
}
function loadTabState() {
    const savedTabs = JSON.parse(localStorage.getItem('chatTabs')) || [];
    const lastTab = localStorage.getItem('lastTab') || [];
    let curTabName;
    savedTabs.forEach(tab => {
        createTab(tab.id, tab.label, tab.id === lastTab);
        if(tab.id === currentTab) curTabName = tab.label;
    });
    // Update document.title with loaded currentTab label
    document.title = windowTitle + ((lastTab === 'lobby') ? 'Lobby' : curTabName);
}

// User List Management
function updateOnlineUsers(users = []) {
    // Filter out current user from main list
    const otherUsers = users.filter(user => user.clientId !== clientId);

    // Update current user display
    const currentUser = users.find(user => user.clientId === clientId);
    if(currentUser) updateCurrentUserDisplay()

    // Rendering code for other users
    const container = document.getElementById('online-users');
    container.innerHTML = users.map((user) => {
        let isCurUser = user.clientId === clientId;
        return `
        <div class="flex items-center p-2 hover:bg-gray-700 rounded cursor-pointer"
             onclick="${isCurUser ? 'toggleSettings()' : `startPM('${user.clientId}');switchTab('${user.clientId}')`}"
             title="${isCurUser ? 'Edit profile' : `User ID: ${user.clientId}\nClick to start private chat`}">
            <span class="text-2xl mr-2">${user.avatar}</span>
            <div class="flex flex-col">
                <div>${isCurUser?'You':user.username}</div>
                <div class="text-gray-400 text-sm">${user.status}</div>
                <span class="${user.connected ? 'text-green-500' : 'text-red-500'} text-sm block">
                ${user.connected ? 'Online' : 'Offline'}
                </span>
            </div>
        </div>
    `;
    }).join('');
}
function updateCurrentUserDisplay() {
    document.getElementById('current-user-avatar').textContent =
        userSettings?.avatar || '👤';
    document.getElementById('current-user-name').textContent =
        sanitizeString(userSettings?.username) || 'Anonymous';
    document.getElementById('current-user-status').textContent =
        sanitizeString(userSettings?.status?.slice(0, 32)) || 'Available';
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
            if(pc.status !== 'stable') await pc.setRemoteDescription(answer);
            // Check if we need to create tab here
            if (!document.querySelector(`[data-tab="${from}"]`)) {
                const user = usersMap.get(from);
                createTab(from, `PM: ${user?.username}`);
                console.log("CREATING ANSWER TAB");
            }
        } catch (e) { console.error('Answer handling error:', e); }
    }
}
async function handleOffer(fromClientId, offer) {
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
            monitorConnection(pc);
        }
    } catch (e) { console.error('Offer handling error:', e); }
}
function handleLobbyMessage(message) {// Save lobby messages
    if (message.user !== 'System') saveChatHistory('lobby', message);
    const chatContainer = document.getElementById('chat-lobby');
    addMessageTo(chatContainer, message);
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
async function establishDataChannel(targetClientId, initiator = true) {
    if (peerConnections[targetClientId]) {
        if (peerConnections[targetClientId].connectionState === 'connected') return; // Connection already exists
        peerConnections[targetClientId].close();
    }
    RTCconfig.iceServers.pop(); // Delete last TURN server (reduce total amount below 5)
    const pc = new RTCPeerConnection(RTCconfig);
    peerConnections[targetClientId] = pc;
    // Unified handler for both offerer and answerer
    pc.ondatachannel = (event) => { setupDataChannel(targetClientId, event.channel); };
    // Common ICE candidate handler
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { toClientId: targetClientId, data: { type: 'candidate', candidate: event.candidate } });
        }
    };
    // Connection state tracking
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected') {
            setTimeout(() => establishDataChannel(targetClientId), TIMEOUT); // Auto-reconnect
        }
    };
    try {
        if (initiator) {
            const dc = pc.createDataChannel('chat', { negotiated: true, id: 0 });
            setupDataChannel(targetClientId, dc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('signal', { toClientId: targetClientId, data: offer });
        }
    } catch (e) { console.error('WebRTC setup error:', e); }
}

// Chat Message & Persistence Handlers
function clearChatHistory() {
    if (confirm('Clear all chat history?')) {
        Object.keys(localStorage).forEach((id) => {
            if (id.startsWith("chatHistory-")) {
                localStorage.removeItem(id);// Clear localStorage chat history data
                const chatContainer = document.getElementById('chat-'+id.substring(12));
                if (chatContainer && id.substring(12) !== 'lobby') chatContainer.innerHTML = '';// Empty chat containers
            }
        });
    }
}
function saveChatHistory(userId, message) {
    try {
        // Get existing history or initialize new array
        const history = JSON.parse(localStorage.getItem(`chatHistory-${userId}`)) || [];
        // Add new message with timestamp
        history.push({ ...message, timestamp: new Date().toISOString() });
        // Save back to localStorage
        localStorage.setItem(`chatHistory-${userId}`, JSON.stringify(history));
        // Limit history size
        if (history.length > 1000) { // Keep last 1000 messages
            localStorage.setItem( `chatHistory-${userId}`, JSON.stringify(history.slice(-1000)) );
        }
    } catch (e) { console.error('Error saving chat history:', e); }
}
function loadChatHistory(userId) {
    const history = JSON.parse(localStorage.getItem(`chatHistory-${userId}`));
    if(!history) return;

    // Get chat container
    let chatContainer = document.getElementById(`chat-${userId}`);
    if (!chatContainer) {
        // Create container if it doesn't exist
        chatContainer = document.createElement('div');
        chatContainer.id = `chat-${userId}`;
        console.log("LOADING HISTORY", (userId === currentTab));
        chatContainer.className = 'overflow-y-auto h-full'+(userId !== currentTab)?'hidden':'';
        document.getElementById('chat-container').appendChild(chatContainer);
    }
    chatContainer.innerHTML = ''; // Clear existing messages

    // Re-add messages from history
    history.forEach(message => addMessageTo(chatContainer, message));
}
async function startPM(targetClientId) {
    if (!targetClientId || targetClientId === clientId) return;
    const user = usersMap.get(targetClientId); if (!user) return;
    // Get user info for tab label
    const tabLabel = `PM: ${user?.username}`;
    createTab(targetClientId, tabLabel, true, true);
    switchTab(targetClientId);
}
function sendMessage() {
    const message = sanitizeString(document.getElementById('message-input').value.trim()); if (!message) return;
    const messageObj = { user: userSettings.username, message, timestamp: new Date().toISOString() };
    document.getElementById('message-input').value = ''; // Clear input textbox

    if (currentTab === 'lobby') {
        socket.emit('lobby-message', messageObj);
    } else {
        let dc = dataChannels[currentTab];
        if (!dc || dc.readyState !== 'open') {
            console.log('Attempting to re-establish data channel for:',currentTab);
            establishDataChannel(currentTab).then(() => {
                dc = dataChannels[currentTab];
                if (dc) {
                    dc.onopen = () => {
                        dc.send(JSON.stringify(messageObj));
                        addMessageToTab(currentTab, messageObj);
                    };
                }
            });
        }else{
            // Data channel is open, send message data
            dc.send(JSON.stringify(messageObj));
            addMessageToTab(currentTab, messageObj);
        }
    }
}
function addMessageTo(container, message){
    if(!container || !message) return;
    const messageElement = document.createElement('div');
    messageElement.className = 'mb-2';// Adds 0.5rem margin to bottom
    messageElement.innerHTML = `
        <span class="timestamp text-gray-400">[${new Date(message.timestamp).toLocaleTimeString()}]</span>
        <strong class="username"></strong><span class="message"></span>`;
    container.appendChild(messageElement);
    messageElement.querySelector(".username").textContent = sanitizeString(message.user) + ": ";
    messageElement.querySelector(".message").textContent = sanitizeString(message.message);
    requestAnimationFrame(() => container.scrollTop = container.scrollHeight); // Scroll to bottom of container automatically
}
function sanitizeString(str) {
    return str; // TODO: sanitize the strings, this does nothing currently
}

// Initialize client.js now that all functions have been defined
initialize().then(() => { });
let socket, usersMap = new Map(), peerConnections = {}, dataChannels = {};
let offlineOverlay = document.getElementById('offline-overlay');
let settingsElem = document.getElementById('settings-modal');
let currentTab, windowTitle, config, getConfig, userSettings, clientId;
let RTCconfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" },], // Fallback public STUN server, updated by `setupICE()`
    iceTransportPolicy: 'all', // Allow both UDP and TCP
    bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require'
};
let RETRIES = 0, FIRST_CONNECT = true;
// Change these variables to whatever you'd like
const MAX_RETRIES = 5, TIMEOUT = 5000, CONFIG_PATH = "res/config.json", COMMAND_TRIGGER = "/";

async function initialize() {
    await loadConfig(CONFIG_PATH);

    // Initialize socket.io server
    const serverUrl = (window.location.hostname === 'localhost' || window.location.hostname === '') ? 'http://localhost:8080' : window.location.origin;
    socket = io(serverUrl, {transports: ['websocket'],reconnectionAttempts: MAX_RETRIES,timeout: TIMEOUT});
    socket.on('connect', () => {
        RETRIES = 0;
        if(FIRST_CONNECT){ // Successfully connected for the first time
            setupSocketListeners(); setupEventListeners();
            createTab('lobby', 'Lobby'); loadTabState(); loadSettings();
            // Update original "Connecting..." text to "Disconnected." once a connection has been made
            document.querySelector(".disconnected-text").textContent = "Disconnected. Attempting to reconnect...";
            const onlineStatusElem = document.querySelector(".current-user-online");
            onlineStatusElem.textContent = "Online";
            onlineStatusElem.classList.remove('text-red-500');
            onlineStatusElem.classList.add('text-green-500');
            FIRST_CONNECT = false;
        }
        // Notify server about user connection
        socket.emit('user-connected', { ...userSettings, clientId: clientId });
        console.log('Connected to server');
        offlineOverlay.classList.add("hidden"); // Hide disconnected overlay
    });
    socket.on('connect_error', (err) => {
        console.log('Connection error',err);
        offlineOverlay.classList.remove("hidden");
        curUserElem.textContent = "Offline";
        curUserElem.classList.remove('text-green-500');
        curUserElem.classList.add('text-red-500');
    });
}
async function loadConfig(path){
    getConfig = await fetch(path);
    config = await getConfig.json(); // Load config.json data into config variable
    document.querySelector('.title-bar-area > .title').innerHTML = config.projectName;
    windowTitle = config.projectName+" - ";//+" v"+config.version;
    // Get userSettings from localStorage, otherwise generate new data
    userSettings = JSON.parse(localStorage.getItem('userSettings')) || generateNewUser();
    clientId = localStorage.getItem('clientId') || undefined;
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
    socket.on('lobby-history', (history) => {history.forEach(msg => addMessageToTab('lobby', msg))});
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('user-connected', handleUserConnected);
    socket.on('signal', handleSignal);
    socket.on('client-id', assignClientId);
    socket.on('reconnect_failed', () => {offlineOverlay.classList.remove("hidden");});
    socket.on('reconnect_attempt', (attempt) => { RETRIES = attempt; offlineOverlay.classList.remove("hidden"); });
}
function setupDataChannel(clientId, dc) {
    dataChannels[clientId] = dc;
    //console.log(`Setting up data channel with ${clientId}`);
    dc.onopen = () => { loadChatHistory(clientId); };
    dc.onclose = () => { delete dataChannels[clientId]; };
    dc.onmessage = (event) => {
        //const data = JSON.parse(event.data);
        // Handle misc dataChannel message events OTHER than just messages
        //if (data.type === 'system' && data.action === 'close-tab') { /*Other user closed the tab*/ } else {
        addMessageToTab(clientId, JSON.parse(event.data));
        //}
    };
}

// Settings Management
function generateNewUser() {
    return {
        username: config.defaultSettings.usernames[Math.floor(Math.random() * config.defaultSettings.usernames.length)],
        avatar: config.defaultSettings.avatars[Math.floor(Math.random() * config.defaultSettings.avatars.length)],
        status: config.defaultSettings.statuses[Math.floor(Math.random() * config.defaultSettings.statuses.length)]
    };
}
function loadSettings(settings = userSettings) {
    // If no userSettings value retrieved from localStorage,
    if(!settings) { userSettings = generateNewUser(); return; }
    document.getElementById('username-input').value = settings.username;
    document.getElementById('avatar-input').value = settings.avatar;
    document.getElementById('status-input').value = settings.status;
}
function saveSettings(settings = userSettings) {
    if(!settings){ console.error("Error saving settings value: ",settings); return; }
    let getUser = document.getElementById('username-input').value;
    let getAvatar = document.getElementById('avatar-input').value;
    let getStatus = document.getElementById('status-input').value;
    if(getUser !== settings.username || getAvatar !== settings.avatar || getStatus !== settings.status){
        // Save any changes made to input values and update userSettings
        userSettings = { username: getUser, avatar: getAvatar, status: getStatus };
    }else{ return; } // Otherwise ignore the rest
    localStorage.setItem('userSettings', JSON.stringify(userSettings)); // Save userSettings value
    localStorage.setItem('clientId', clientId); // Save clientId value
    socket.emit('user-update', userSettings); // Send user-update with new userSettings to update other clients
    updateCurrentUserDisplay(); // Update the user profile with new values
}
function toggleSettings() {document.getElementById('settings-modal').classList.toggle('hidden');}
function assignClientId(data){
    if(clientId) { return; } // clientId already assigned
    clientId = data; localStorage.setItem('clientId', data);
}

// Tab Management
function createTab(id, label, isActive = false) {
    // Check if tab already exists
    const existingTab = document.querySelector(`[data-tab="${id}"]`);
    if (existingTab) {
        if(isActive) switchTab(id);
        // Check if user is online and attempt connection
        console.log("createtab already exists, switching",dataChannels, id);
        return;
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
    tab.className = `px-8 py-2 text-2xl rounded-t-lg ${isActive ? 'bg-gray-800' : 'bg-gray-700 hover:bg-gray-600'}`;
    tab.textContent = label;
    tab.dataset.tab = id;

    // Create onclick handler for each tab & switch to it on click
    tab.onclick = () => { if(id !== 'lobby') { startPM(id);console.log("STARTINGPM"); }else{ switchTab(id); } }

    // Create right click handler & close the tab upon click
    tab.oncontextmenu = (e) => {
        e.preventDefault();
        if (id !== 'lobby') {
            console.log("DELETING TAB");
            tab.remove(); // Delete tab element
            //dataChannels[id].close();
            //delete dataChannels[id]; // Cleanup data channel
            console.log(dataChannels, id);
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
    // Display the chat-container div for currentTab
    document.querySelectorAll('#chat-container > div').forEach(div => {
        div.style.display = (div.id === `chat-${currentTab}`)?'block':'none';
    });

    // Check if user is online and attempt connection
    console.log(dataChannels, id);
    const user = usersMap.get(id);
    if (user?.connected) establishDataChannel(id).then(() => console.log("Data channel created with "+id));

}
function switchTab(tabId) {
    console.log("switch tab request (switch to",tabId,")");
    let tabName="Lobby";
    currentTab = tabId;
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
    // Update 'chatTabs' + 'lastTab' localStorage values and window title
    saveTabState();
    const curChat = document.getElementById('chat-'+currentTab); if(!curChat) return;
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
    const savedTabs = JSON.parse(localStorage.getItem('chatTabs')) || [{id:'lobby',label:'Lobby'}];
    const lastTab = localStorage.getItem('lastTab') || [];
    currentTab = localStorage.getItem('lastTab') || 'lobby';
    let curTabName;
    // Create a tab for each savedTab value
    savedTabs.forEach(tab => {
        createTab(tab.id, tab.label, tab.id === lastTab);
        if(tab.id === currentTab) curTabName = tab.label;
    });
    // Load PM histories for existing tabs
    document.querySelectorAll('[data-tab]').forEach(tab => {
        const tabId = tab.dataset.tab;
        if (tabId !== 'lobby') loadChatHistory(tabId);
    });
    // Update document.title with loaded currentTab label
    document.title = windowTitle + ((lastTab === 'lobby') ? 'Lobby' : curTabName);
}

// User List Management
function updateOnlineUsers(users = []) {
    usersMap = new Map(users?.map(user => [user.clientId, user]));
    // Update current user display
    const currentUser = users.find(user => user.clientId === clientId);
    if(currentUser) updateCurrentUserDisplay();
    // Rendering code for other users
    const container = document.getElementById('online-users'); if(!container) return;
    container.innerHTML = ''; // Since we use innerHTML += to add each user, we reset it each new call
    // Sort the users array to move the current user to the top
    users.sort((userA, userB) => {
        // If userA is the current user, place it at the top
        if (userA.username === userSettings.username) return -1;
        // If userB is the current user, move userA down
        if (userB.username === userSettings.username) return 1;
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
                ('Click to start private chat\n\nStatus: '+sanitizeString(user.status)+
                '\nUser ID: '+user.clientId+'')
            );
        container.querySelector(".user-"+usernameParsed+" .username").textContent = sanitizeString(user.username);
        container.querySelector(".user-"+usernameParsed+" .status").textContent = sanitizeString(user.status);
    }).join('');
}
function updateCurrentUserDisplay() {
    document.getElementById('current-user-avatar').textContent = userSettings.avatar;
    document.getElementById('current-user-name').textContent =
        sanitizeString(userSettings.username?.slice(0, 32));
    document.getElementById('current-user-status').textContent =
        sanitizeString(userSettings.status?.slice(0, 32));
    let userListItem = document.querySelector(`.user-profile[title*="${clientId}"]`);
    if(!userListItem) return;
    userListItem.querySelector(".username").textContent = sanitizeString(userSettings.username?.slice(0, 32));
    userListItem.querySelector(".avatar").textContent = userSettings.avatar;
    userListItem.querySelector(".status").textContent = sanitizeString(userSettings.status?.slice(0, 32));
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
    console.log(dataChannels, peerConnections);
    console.log("ESTABLISH DATA CHANNEL WITH",targetClientId);
    if (peerConnections[targetClientId]) {
        if (peerConnections[targetClientId].connectionState === 'connected') return; // Connection already exists
        peerConnections[targetClientId].close();
    }
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
                if (chatContainer) chatContainer.innerHTML = '';// Empty chat containers
            }else if(id === 'chatTabs' || id === 'lastTab'){
                localStorage.removeItem(id);// Clear tab data also
            }
        });
        window.location.reload(); // Reload the page
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
    console.log("STARTING NEW PM WITH", targetClientId,"creating and switching to new tab too");
    console.log("either user or tab was clicked on");
    if (!targetClientId || targetClientId === clientId) return; // Invalid user (or user is self)
    const user = usersMap.get(targetClientId); if (!user) return;
    const tabLabel = `PM: ${user?.username}`; // Get user info for tab label
    createTab(targetClientId, tabLabel, true); // Only creates tab if it doesnt exist
    switchTab(targetClientId);
}
function sendMessage() {
    const message = sanitizeString(document.getElementById('message-input').value.trim()); if (!message) return;
    const messageObj = { user: userSettings.username, message, timestamp: new Date().toISOString() };
    document.getElementById('message-input').value = ''; // Clear input textbox

    if (currentTab === 'lobby') {
        // Handle lobby message
        switch(messageObj.message){
            case COMMAND_TRIGGER+'test':
                socket.emit('user-command', { clientId: clientId, command: 'test' });
                break;
            case COMMAND_TRIGGER+'help':
                socket.emit('user-command', { clientId: clientId, command: 'help' });
                break;
        }
        socket.emit('lobby-message', messageObj);
    } else {
        // Handle PM messages
        let dc = dataChannels[currentTab];
        if (!dc || dc.readyState !== 'open') {
            console.log('Attempting to re-establish data channel with:',currentTab);
            establishDataChannel(currentTab).then(() => {
                dc = dataChannels[currentTab];
                if (dc) {
                    dc.onopen = () => {
                        console.log('Re-established data channel! With:',currentTab);
                        dc.send(JSON.stringify(messageObj));
                        addMessageToTab(currentTab, messageObj);
                    };
                }
            });
        }else{
            console.log("sending PM");
            // Data channel is open, send message data
            dc.send(JSON.stringify(messageObj));
            addMessageToTab(currentTab, messageObj);
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
    messageElement.querySelector(".username").textContent = sanitizeString(message.user) + ": ";
    messageElement.querySelector(".message").textContent = sanitizeString(message.message);
    requestAnimationFrame(() => container.scrollTop = container.scrollHeight); // Scroll to bottom of container automatically
}
function sanitizeString(str) {
    return str; // TODO: sanitize the strings, this does nothing currently
}

// Initialize client.js now that all functions have been defined
initialize().then(() => { });
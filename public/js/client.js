let socket, usersMap = new Map(), peerConnections = {}, peerConnectionStates = {}, dataChannels = {};
let currentTab, windowTitle, config, userSettings, clientId, mobileMenuOpen = false;
let RETRIES = 0, FIRST_CONNECT = true, IS_MOBILE, RTC_CONFIG = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" },],
    bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceTransportPolicy: 'all', // Allows both UDP and TCP
};
const ELEM = {
    messageInput: $('#message-input'), chatContainer: $('#chat-container'),
    onlineUsers: $('#online-users'), currentUser: $('#current-user'),
    themeSelect: $('#theme-select'), tabsContainer: $('#tabs'),
    offlineOverlay: $('#offline-overlay'), curUserElem: $('.current-user-online'),
    mobileMenuElem: $('#mobile-menu-btn'), usernameInput: $('#username-input'),
    avatarInput: $('#avatar-input'), statusInput: $('#status-input'),
    onlineUsersArea: $('.onlineusers-area'), chatArea: $('.chatbox-area')
};
// Change these variables to whatever you'd like
const DEBUG = { networking: false, tabs: false, messages: false, localStorage: false };
const CONFIG_PATH = "config.json", COMMAND_TRIGGER = "/", MAX_RETRIES = 5, TIMEOUT = 5000, MESSAGE_LIMIT = 100;
const TAB_CLASSES = { default: 'btn tab rounded-0 rounded-top mx-1 border border-bottom-0 ',
    active: 'tab-active', inactive: 'tab-inactive', unread: 'tab-inactive unread-msg'
};

// Window, File, and Storage Helpers
async function initialize() {
    await initConfig(CONFIG_PATH);
    loadTheme();
    // Initialize socket.io server
    const serverUrl = (window.location.hostname === '') ? 'http://localhost:8080' : window.location.origin;
    // TODO: change serverUrl to window.location.origin in production, the above is just for localhost testing
    socket = io(serverUrl, {transports: ['websocket'],reconnectionAttempts: MAX_RETRIES,timeout: TIMEOUT});
    socket.on('connect', () => { RETRIES = 0;
        if(FIRST_CONNECT){ FIRST_CONNECT = false; // Successfully connected for the first time
            setupSocketListeners(); setupEventListeners(); loadSettings(); loadTabState();
            $('.disconnected-text').text("Disconnected. Attempting to reconnect...");
        }
        ELEM.curUserElem.text("Online").removeClass('text-danger').addClass('text-success');
        socket.emit('user-connected', { ...userSettings, clientId: clientId.length>0?clientId:undefined });
        if(DEBUG.networking) console.log('[Socket] Connected to server successfully!');
        ELEM.offlineOverlay.addClass("d-none");
    });
    socket.on('connect_error', () => {
        ELEM.offlineOverlay.removeClass("d-none");
        ELEM.curUserElem.text("Offline").removeClass('text-success').addClass('text-danger');
    });
}
async function initConfig(path) {
    config = await (await fetch(path)).json(); // Load config.json data into config variable
    // Set .title text & data-text to value found in config.json under 'projectName'
    $('.title-bar-area > .title').text(config.projectName).attr('data-text', config.projectName);
    windowTitle = config.projectName + " - "; // Set windowTitle value to projectName
    // Get userSettings from localStorage, otherwise generate new data
    userSettings = getLocalStorage('userSettings', generateNewUser());
    setLocalStorage('userSettings', userSettings);
    clientId = getLocalStorage('clientId', []);
    IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent); // Check if mobile device (for applyMobileLayout)
}
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
    // Use jQuery for any DOM-related storage operations
    if (key === 'userSettings') { ELEM.usernameInput.val(value.username); ELEM.avatarInput.val(value.avatar); ELEM.statusInput.val(value.status); }
    // Automatically trim chat history arrays
    if (key.startsWith('chatHistory-') && Array.isArray(value)) {
        localStorage.setItem(key, JSON.stringify(value.slice(-MESSAGE_LIMIT))); //key === 'chatHistory-lobby' ? 99 : 999;
    } else { localStorage.setItem(key, JSON.stringify(value)); } // Just set the item
    if(DEBUG.localStorage) console.log(`[LocalStorage] Setting ${key}`, value);
}
function loadTheme() {
    const savedTheme = getLocalStorage('theme', 'dark'); // Default to dark theme
    $('html').attr('data-theme', savedTheme); ELEM.themeSelect.val(savedTheme);
}
function saveTheme(theme) { setLocalStorage('theme', theme); $('html').attr('data-theme', theme); }

// Event Listeners
function setupEventListeners() {
    ELEM.messageInput.on('keypress', (e) => { if(e.key === 'Enter') sendMessage(); });
    $(window).on("resize", applyMobileLayout); applyMobileLayout(); // Call right away to initialize
    ELEM.themeSelect.change(function() {saveTheme($(this).val());}); // On input change, save & apply the selected theme
}
function setupSocketListeners() {
    socket.on('users-updated', updateOnlineUsers);
    socket.on('lobby-message', handleLobbyMessage);
    socket.on('lobby-history', handleLobbyHistory);
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('user-connected', handleUserConnected);
    socket.on('signal', handleSignal);
    socket.on('client-id', assignClientId);
    socket.on('reconnect_failed', () => { ELEM.offlineOverlay.removeClass("d-none"); });
    socket.on('reconnect_attempt', (attempt) => { RETRIES = attempt; ELEM.offlineOverlay.removeClass("d-none"); });
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
    if(!settings) settings = userSettings = generateNewUser(); // If no settings or !userSettings, generateNewUser
    setLocalStorage('userSettings',settings);
}
function saveSettings() {
    const oldUsername = userSettings.username;
    const newSettings = { username: ELEM.usernameInput.val(), avatar: ELEM.avatarInput.val(), status: ELEM.statusInput.val() };
    if (JSON.stringify(newSettings) !== JSON.stringify(userSettings)) {
        userSettings = newSettings;
        socket.emit('user-update', userSettings);
        setLocalStorage('userSettings', userSettings);
        updateCurrentUserDisplay();
        if (oldUsername !== userSettings.username) { // Handle username updates
            updateChatHistoryUsernames(oldUsername, userSettings.username);
            // Reload all chat histories for every tab to update usernames
            $('[data-tab]').each((i, tab) => loadChatHistory(tab.dataset.tab));
        }
    }
}

// Tab Management
function createTab(id, label, isActive = false) {
    if(DEBUG.tabs) console.log(`[Tab] Creating new tab named '${id}' which is ${isActive?'':'not '}active`);
    if($(`[data-tab="${id}"]`).length) { // Check if tab already exists
        if(isActive && currentTab !== id) { switchTab(id); if(DEBUG.tabs){console.log(`[Tab] Tab ${id} already exists, switching...`);} }
        return;
    }
    if(isActive) {
        $('#tabs button.btn').each(function() { $(this).attr('class', TAB_CLASSES.default+TAB_CLASSES.inactive); });
        currentTab = id; showCurTabChat();
    }
    const tab = $(`<button>`).addClass(TAB_CLASSES.default+(isActive ? TAB_CLASSES.active : TAB_CLASSES.inactive))
        .text(label).attr('data-tab', id).click(() => switchTab(id)).on('contextmenu', e => { e.preventDefault();
            if(id !== 'lobby') { tab.remove(); if(currentTab === id) switchTab('lobby'); saveTabState(); }
            if(DEBUG.tabs) console.log(`[Tab] Closing PM tab with ${id}`);
        });
    ELEM.tabsContainer.append(tab); saveTabState();
    if(id !== 'lobby' && usersMap.get(id)?.connected) establishDataChannel(id);
}
function switchTab(tabId) {
    if(DEBUG.tabs) console.log("[Tab] Switching tabs to",tabId);
    if (tabId === currentTab) { if(DEBUG.tabs) { console.log("[Tab] Already on tab", tabId); } return; }
    currentTab = tabId; saveTabState(); showCurTabChat();
    // Assign classes depending on the 'data-tab' value (tabId matched? use different TAB_CLASSES class list)
    ELEM.tabsContainer.find('button').each((i, btn) => {
        $(btn).attr('class', TAB_CLASSES.default+(btn.dataset.tab === tabId ? TAB_CLASSES.active : TAB_CLASSES.inactive));
    });
}
function showCurTabChat() {
    if (ELEM.onlineUsersArea.hasClass('active')) toggleMobileMenu();
    // Create chat div for currentTab messages if it doesn't already exist
    if(!$(`#chat-${currentTab}`).length) {
        ELEM.chatContainer.append($(`<div>`).attr('id', `chat-${currentTab}`).addClass('overflow-y-auto h-full'));
    }
    // Show or hide the chat containers based on whether it's the currentTab or not
    ELEM.chatContainer.children().each((i, div) => $(div).toggleClass('d-none', div.id !== `chat-${currentTab}`));
    loadChatHistory(currentTab); // Load chat history of the currentTab
}
function addMessageToTab(tabId, message) {
    const chatContainer = $(`#chat-${tabId}`);
    if (!chatContainer.length) { createTab(tabId, `🔐 - ${message.user}`); return; }
    addMessageTo(chatContainer, message);
    if(tabId !== 'lobby') saveChatHistory(tabId, message);
    if(currentTab !== tabId) chatContainer.addClass('d-none'); // Ensures chat window is hidden if it's not the currentTab
}
function loadTabState() {
    let curTabName, savedTabs = getLocalStorage('chatTabs', [{id:'lobby',label:'🏠 Lobby'}]);
    currentTab = getLocalStorage('lastTab', 'lobby');
    savedTabs.forEach(tab => { // Create a tab for each savedTab value
        createTab(tab.id, tab.label, tab.id === currentTab);
        if(tab.id === currentTab) curTabName = tab.label;
    });
    $('[data-tab]').each((i, tab) => {if (tab.dataset.tab !== 'lobby') loadChatHistory(tab.dataset.tab);});
    document.title = windowTitle + ((currentTab === 'lobby') ? '🏠 Lobby' : curTabName);
}
function saveTabState() {
    const tabs = $('#tabs button').map((i, btn) => ({ id: $(btn).data('tab'), label: $(btn).text() })).get();
    let tabName; $.each(tabs, (i, tab) => { if (tab.id === currentTab) { tabName = tab.label; } });
    setLocalStorage('chatTabs', tabs); setLocalStorage('lastTab', currentTab);
    document.title = windowTitle + ((currentTab === 'lobby') ? '🏠 Lobby' : tabName);
}

// User List Management & UI Handlers
function getUserProfileHTML(username, isCurUser, clientId, isConnected) {
    return `<div class="user-profile user-${username} d-flex align-items-center p-2 mb-2 rounded-3 cursor-pointer user-select-none"
        ${isCurUser?`title="Edit your profile" data-bs-toggle="modal" data-bs-target="#settings-modal"`:
        `title="Click to start Private Messaging" onclick="startPM('${clientId}')"`}>
        <span class="user-avatar fs-5 me-2"></span>
        <div class="flex-grow-1 text-truncate">
            <div class="d-flex align-items-center">
                <div class="user-name text-truncate"></div>${isCurUser ? '<span class="badge bg-primary ms-2">You</span>' : ''}
            </div>
            <div class="user-status small text-truncate"></div>
            <span class="user-online small ${isConnected ? 'text-success' : 'text-danger'}">${isConnected ? 'Online' : 'Offline'}</span>
        </div>
    </div>`;
}
function handleUsernameChange(clientId, oldUsername, newUsername) {
    const pmTab = $(`[data-tab="${clientId}"]`);
    if (pmTab.length) { pmTab.text(`🔐 - ${newUsername}`); saveTabState(); }
    updateChatHistoryUsernames(oldUsername, newUsername);
    // Force reload all affected chat histories
    $('[data-tab]').each((i, tab) => loadChatHistory(tab.dataset.tab));
}
function updateChatHistoryUsernames(oldName, newName) {
    // Update all chat history data (both lobby and PM localStorage data)
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('chatHistory-')) {
            const history = getLocalStorage(key, []);
            setLocalStorage(key, history.map(msg => {if (msg.user === oldName) { return {...msg, user: newName}; } return msg;}));
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
    const container = ELEM.onlineUsers.empty();
    users.sort((a, b) => a.username === userSettings.username ? -1 : b.username === userSettings.username ? 1 : 0)
        .forEach(user => {
            const isCurUser = user.username === userSettings.username;
            if(isCurUser) updateCurrentUserDisplay();
            const usernameParsed = user.username.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
            const userHtml = $(getUserProfileHTML(usernameParsed, isCurUser, user.clientId, user.connected));
            // Set tooltip text
            userHtml.attr('title', isCurUser ? `Status: ${userSettings.status}\n\nEdit your profile` :
                `Status: ${user.status}\n\nClick to start Private Messaging`);
            // Set user info afterward via .text to ensure user inputs are sanitized
            userHtml.find('.user-name').text(user.username);
            userHtml.find('.user-avatar').text(user.avatar);
            userHtml.find('.user-status').text(user.status);
            container.append(userHtml);
        });
}
function updateCurrentUserDisplay() {
    $('#current-user-avatar').text(userSettings.avatar);
    $('#current-user-name').text(userSettings.username);
    $('#current-user-status').text(userSettings.status);
    const userListItem = $(`.user-profile[title*="${clientId}"]`); if(!userListItem.length) return;
    userListItem.find(".username").text(userSettings.username);
    userListItem.find(".avatar").text(userSettings.avatar);
    userListItem.find(".status").text(userSettings.status);
}
function toggleMobileMenu() {
    mobileMenuOpen = !mobileMenuOpen;
    ELEM.onlineUsersArea.toggleClass('active'); ELEM.chatArea.toggleClass('active');
    ELEM.mobileMenuElem.text(mobileMenuOpen ? '🗙':'☰');
}
function applyMobileLayout() {$('html').toggleClass('mobile-layout',IS_MOBILE || window.innerWidth < 768);}

// Message & WebRTC Handlers
async function handleCandidate(from, data) {
    const pc = peerConnections[from]; if (!pc || !data.candidate) return;
    try {
        const candidateData = { // Validate required candidate fields
            candidate: data.candidate.candidate,
            sdpMid: data.candidate.sdpMid || '0',
            sdpMLineIndex: data.candidate.sdpMLineIndex ?? 0,
            usernameFragment: data.candidate.usernameFragment || ''
        };
        if (!candidateData.candidate.includes('typ')) return; // Validate candidate format
        await pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (e) { /*if(DEBUG.networking) console.error('[WebRTC] Error handling ICE candidate:', e); spams the console */ }
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
        monitorConnection(pc);
        if(pc.status !== 'stable') await pc.setRemoteDescription(answer);
        // Check if we need to create new PM tab
        if (!$(`[data-tab="${from}"]`).length) startPM(from);
    } catch (e) { if(DEBUG.networking) console.error('[WebRTC] Error handling answer:', e); }
}
async function handleOffer(fromClientId, offer) {
    if(DEBUG.networking) console.log(`[WebRTC] Handling offer from ${fromClientId}`);
    const pc = new RTCPeerConnection(RTC_CONFIG); peerConnections[fromClientId] = pc;
    // Create data channel immediately for responder
    const dc = pc.createDataChannel('chat', { negotiated: true, id: 0 });
    setupDataChannel(fromClientId, dc);
    // Create tab for incoming PM
    const user = usersMap.get(fromClientId);
    createTab(fromClientId, `🔐 - ${user?.username}`);
    // Handle data channel setup
    monitorConnection(pc);
    pc.ondatachannel = (event) => { setupDataChannel(fromClientId, event.channel); };
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const newCandidate = { type: 'candidate', candidate: {
                candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid || '0', // Default to '0' if missing
                sdpMLineIndex: event.candidate.sdpMLineIndex || 0, usernameFragment: event.candidate.usernameFragment
            }};
            // Send ICE candidate offer + data
            socket.emit('signal', { toClientId: fromClientId, data: newCandidate });
            if(DEBUG.networking) console.log(`[Socket] Sending ICE candidate signal data to ${fromClientId}`);
        }
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
    addMessageTo($('#chat-lobby'), message); saveChatHistory('lobby', message);
}
function handleLobbyHistory(history) {
    if(DEBUG.networking) console.log('[Socket] Received lobby chat history data!', history);
    const lobbyChat = $('#chat-lobby');
    if (lobbyChat.length) {
        lobbyChat.empty(); // Clear existing messages before adding the server's history
        history.forEach(msg => addMessageTo(lobbyChat, msg));
    }
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
        if (data.type === 'offer') { await handleOffer(fromClientId, data); }
        if (data.type === 'answer') { await handleAnswer(fromClientId, data); }
        if (data.type === 'candidate') { await handleCandidate(fromClientId, data); }
    } catch (e) { console.error('Signal handling error:', e); }
}
function monitorConnection(pc) {
    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') pc.restartIce();
    };
}
function cleanupConnection(clientId) {
    if(DEBUG.networking) console.log(`[WebRTC] Cleaning up connection to ${clientId}`);
    // Cleanup peer connections, connection states, and data channel values for clientId
    if (peerConnections[clientId]) { peerConnections[clientId].close(); delete peerConnections[clientId]; }
    delete peerConnectionStates[clientId]; delete dataChannels[clientId];
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
    const pc = new RTCPeerConnection(RTC_CONFIG);
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
function assignClientId(data) { clientId = data; setLocalStorage('clientId', data); }

// Chat Message & Persistence Handlers
function clearChatHistory() {
    if (confirm('Clear all chat history?')) {
        Object.keys(localStorage).forEach((id) => {if(id.startsWith("chatHistory-"))localStorage.removeItem(id)});
        ELEM.chatContainer.children().not('#chat-lobby').remove(); $('#chat-lobby').empty();
        //window.location.reload(); // Use if you want to reload lobby chat history from server
    }
}
function loadChatHistory(userId) {
    const history = getLocalStorage(`chatHistory-${userId}`, []);
    const chatContainer = $(`#chat-${userId}`);
    if(!chatContainer.length){ELEM.chatContainer.append($('<div>').attr('id',`chat-${userId}`).addClass('overflow-y-auto h-full'));}
    chatContainer.empty(); history.forEach(message => addMessageTo(chatContainer, message));
    chatContainer.toggleClass('d-none', userId !== currentTab);
}
function saveChatHistory(userId, message) {
    try {
        const history = getLocalStorage(`chatHistory-${userId}`, []);
        history.push({ ...message, timestamp: new Date().toISOString(), clientId: (userId === 'lobby' ? message.clientId : userId) });
        setLocalStorage(`chatHistory-${userId}`, history);
    } catch (e) { console.error('Error saving chat history:', e); }
}
function startPM(targetClientId) {
    if (!targetClientId || targetClientId === clientId) { if(DEBUG.messages) {console.log("[PM] Invalid PM target");} return; }
    const $existingTab = $(`[data-tab="${targetClientId}"]`);
    if ($existingTab.length) {
        if (DEBUG.messages) {console.log(`[PM] Switching to PM with ${targetClientId}`);} switchTab(targetClientId); return;
    }
    if(DEBUG.messages) console.log(`[PM] Starting new PM with ${targetClientId}`);
    createTab(targetClientId, `🔐 - ${usersMap.get(targetClientId)?.username}`, true);
}
function sendMessage() {
    const message = ELEM.messageInput.val().trim(); if(!message) return;
    const messageObj = { user: userSettings.username, message, timestamp: new Date().toISOString() };
    ELEM.messageInput.val(''); // Clear input textbox
    if(currentTab === 'lobby') { // Handle lobby message
        if(DEBUG.messages) console.log(`[Message] Sending message data to ${currentTab}`);
        socket.emit('lobby-message', messageObj);
    } else { // Handle PM messages
        let dc = dataChannels[currentTab];
        if (!dc || dc.readyState !== 'open') { // Check if user still exists and is connected, if not, return
            if(!usersMap.get(currentTab)?.connected) return;
            if(DEBUG.networking) console.log(`[WebRTC] Attempting to re-establish data channel with: ${currentTab}`);
            establishDataChannel(currentTab).then(() => { dc = dataChannels[currentTab];
                dc.onopen = () => {
                    if(DEBUG.networking) console.log(`[WebRTC] Re-established! (with: ${currentTab})`);
                    dc.send(JSON.stringify(messageObj)); addMessageToTab(currentTab, messageObj);
                }
            });
        }else{
            if(DEBUG.messages && DEBUG.networking) console.log(`[Message/WebRTC] Sending message data to ${currentTab}`);
            dc.send(JSON.stringify(messageObj)); addMessageToTab(currentTab, messageObj);
        }
    }
}
function addMessageTo(container, message){
    if(!container || !message) {console.error("INVALID CONTAINER OR MESSAGE IN ADDMSGTO:",container,message);return;}
    const containerElem = $(container), parentElem = containerElem.parent().get(0) || containerElem.get(0);
    const messageElem = $('<div>').addClass('mb-1').html(`
        <div class="message-wrapper d-flex align-items-center gap-1">
            <div class="timestamp text-secondary font-mono small"></div><strong class="username text-primary"></strong>:<span class="message text-break"></span>
        </div>`);
    messageElem.find('.timestamp').text(`(${new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(' ', '')})`);
    messageElem.find(".username").text(message.user); messageElem.find(".message").text(message.message);
    containerElem.append(messageElem);
    if (parentElem) requestAnimationFrame(() => $(parentElem).scrollTop($(parentElem).prop('scrollHeight')));
}

// Initialize client.js now that all functions have been defined
initialize();
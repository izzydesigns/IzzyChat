Bugs
===

- Users can have the same username (server/client do not check if username matches existing users before changing)
- No indication whose messages are whose when usernames change (need to update prev chat messages & PM tabs)
- Anyone can create a PM datastream with anyone else (currently no approval process before accepting new PMs)
- Establishing a PM connection is unclear and uncertain. Sometimes one person can message while another cannot
  - In specific page refreshing orders and tab closing/opening orders, both users see messages but only one can send
  - Sometimes no connection can be made, despite console printing "Data channel created"
- No profanity filter (add settings option to enable/disable and update all text automatically)

Add
===

- Ability to specify image/gif URL for avatars as well as the current emoji system (upload as base64 data?)
- 'x' button on PM tabs
- Embedded links as clickable URLs that open in the system's default browser (outside the electron app)
- Emoji menu & list of most used emojis
- GIFs menu & embedded GIFs, ability to favorite gifs
- Add faux voice/video call buttons (for later implementation)
- File transfer (warn upon download of PDF, EXE, or other risky file types?)
  - Limit to specific whitelist of file types in config.json
- /me command and support for other /commands
- Add jQuery since we interface with the DOM so much (+ jQuery UI may be useful)
- Ability to send messages to offline users, mark as pending and send to recipient upon next connect
- Add read receipts
- Add friend requests before allowing PMs from other users (or PM request popup)
  - If incoming user PM request is not a friend, show PM request prompt, otherwise create PM datachannel immediately
  - Sender sees message as "pending" until the person receives it and sends the read receipt
  - PM requests lead to datachannel creation but no friend request, closing will require approval of another PM request

Improve
===

- Improve UX
  - Anchor the user to new area below "online users" list & filter user out of old list
    - Add current user to HTML, not in JS code, and update it separate from other users
  - Clicking on your own user in the users list sidebar should open the settings menu
  - Visual indicator for when a tab contains unread messages (background pulses or something)
  - Add soft notification sound to incomming PM messages when that PM tab isn't currentTab
  - Add soft outline pulse to tabs that have unread PM messages
  - Add app settings such as notification volume, background color, notification toggle, etc...
  - Current settings menu updated to have profile settings, app settings, and about page tabs
  - Track previous alias changes for users
    - Maybe send a system message on connect and loaded clientId with username that doesn't match localstorage value
    - Maybe hovering over user in users list shows "Previous Aliases" area with last 3 username changes (store in server)
- Display all previously connected users for the server session in sidebar for all clients
- Limit how fast users can change usernames, avatars, and statuses
- Create some kind of electron app logo and/or website favicon
- (once electron is added) Add custom window UI buttons

Unique Ideas
===

- Create a gif library where all gifs "starred" are saved. Create custom categories for gifs as user desires
- Send audio clips back and forth via chat messages
- "Inbox" for all unanswered pings and PM requests (containing short message snippet)
- Visible on hover, number of times you've used each emoji (since we track it for most used emojis in emoji menu)
- Add crown icon next to people with elevated privileges similar to Jmods in Runescape
Bugs
===

- Users can have the same username (server & client do not check if username matches existing users before changing)
- No indication whose messages are whose when usernames change (need to update prev chat messages & PM tabs)
- Anyone can create a PM datastream with anyone else (currently no approval process before accepting new PMs)
- No profanity filter (add settings option to enable/disable and update all text automatically)
- No indication when message sending failed or why (mostly when a user goes offline during a PM session)
- Certain mobile screens are too wide for static 768px width check on mobile
  - Simply check if width is roughly half the height instead? Or check if height is taller than desktop?

Add
===

- 'x' button on PM tabs
- /me command and support for other /commands
- Broadcast username update changes to all relevant chat windows
- Clicking logo/server title opens browser outside of electron, into the chat via browser instead (or refreshes page)
- Add faux voice/video call buttons to the UI (non-functional for now)
- Add message read receipts
- Ability to send messages to offline users, mark as pending and send to recipient upon next connect
- Ability to specify image/gif URL for avatars as well as the current emoji system (upload as base64 data?)
- Emoji menu & list of most used emojis
- Add jQuery since we interface with the DOM so much (+ jQuery UI may be useful)
- Embedded links as clickable URLs that open in the system's default browser (outside the electron app)
- Add friend requests before allowing PMs from other users (or PM request popup)
  - If incoming user PM request is not a friend, show PM request prompt, otherwise create PM datachannel immediately
  - Sender sees message as "pending" until the person receives it and sends the read receipt
  - PM requests lead to datachannel creation but no friend request, closing will require approval of another PM request
- GIFs menu & embedded GIFs, ability to favorite gifs
- File transfer (warn upon download of PDF, EXE, or other risky file types?)
  - Limit to specific whitelist of file types in config.json

Improve
===

- Improve UX
  - Visual indicator for when a tab contains unread messages (background pulses or something)
  - Add soft notification sound to incomming PM messages when that PM tab isn't currentTab
  - Add soft outline pulse to tabs that have unread PM messages
  - Add app settings such as notification volume, background color, notification toggle, etc...
  - Update current settings menu to have tabs for profile settings, app settings, and about page
  - Track previous alias changes for users
    - Maybe send a system message on connect and loaded clientId with username that doesn't match localstorage value
    - Maybe hovering over user in users list shows "Previous Aliases" area with last 3 username changes (store in server)
- Display all previously connected users for the server session in sidebar for all clients (persistent user history)
- Limit how fast users can change usernames, avatars, and statuses (overall audit on rate limit)
- (once friend/pm requests added) "Inbox" for all unanswered pings and PM requests containing short message snippet

Unique Ideas
===

- Create a gif library where all gifs "starred" are saved. Create custom categories for gifs as user desires
- Send audio clips back and forth via chat messages
- Visible on hover, number of times you've used each emoji (since we track it for most used emojis in emoji menu)
- Add crown icon next to people with elevated privileges similar to Jmods in Runescape
- Recreate BlahTherapy system for venting and listening anonymously!
- Ability to stream music to each other (music files at first) and live scrub together
  - Also allow queueing and skipping
  - Add cool music visualizers like milkdrop? (interactive!)
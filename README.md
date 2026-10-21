# proton-mcp

MCP server for the **Proton privacy suite** — Mail, Pass, Drive, Calendar, and VPN. 36 tools for Claude and other MCP-compatible AI agents.

Built by Scott Jorgensen and Jorgenclaw (AI agent) for the [jorgenclaw.ai](https://jorgenclaw.ai) sovereignty stack.

## Requirements

- **Proton Mail Bridge** — running on the host (provides IMAP/SMTP access to Proton Mail)
- **pass-cli** — [Proton Pass CLI](https://proton.me/pass/download) for password manager tools
- **Node.js 22+**

## Installation

```bash
git clone https://github.com/jorgenclaw/proton-mcp.git
cd proton-mcp
npm install
```

Create a `.env` file from the example:

```bash
cp .env.example .env
# Edit .env with your Proton Bridge credentials
```

## Configuration

```env
PROTON_BRIDGE_IMAP_HOST=127.0.0.1
PROTON_BRIDGE_SMTP_HOST=127.0.0.1
PROTON_BRIDGE_IMAP_PORT=1143
PROTON_BRIDGE_SMTP_PORT=1025
PROTON_BRIDGE_USERNAME=your@proton.me
PROTON_BRIDGE_PASSWORD=your-bridge-password
```

Alternatively, put the same settings in `~/.proton-mcp/bridge.json` (keys `imap_host`, `imap_port`, `smtp_host`, `smtp_port`, `username`, `password`); it takes precedence over the env vars.

The Bridge password is found in Proton Bridge → Settings → your account → IMAP/SMTP password (this is NOT your Proton account password).

## Usage

### With Claude Desktop

Add to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "proton": {
      "command": "node",
      "args": ["/path/to/proton-mcp/index.js"],
      "env": {
        "PROTON_BRIDGE_IMAP_HOST": "127.0.0.1",
        "PROTON_BRIDGE_SMTP_HOST": "127.0.0.1",
        "PROTON_BRIDGE_IMAP_PORT": "1143",
        "PROTON_BRIDGE_SMTP_PORT": "1025",
        "PROTON_BRIDGE_USERNAME": "your@proton.me",
        "PROTON_BRIDGE_PASSWORD": "your-bridge-password"
      }
    }
  }
}
```

### With NanoClaw

Mount as an MCP server in the container configuration. See the [NanoClaw docs](https://github.com/qwibitai/nanoclaw) for MCP server setup.

### Standalone

```bash
node --env-file=.env index.js
```

The server communicates via MCP stdio protocol.

## Tools (36)

`message_id` is the message's IMAP UID, which stays stable within a folder. Tools that act on a message take an optional `folder` (default `INBOX`); pass the `folder` that `mail__search_messages` returns for results outside the inbox. `mail__move_message` takes `source_folder` for this, since `folder` is its destination.

### Mail (15 tools)

| Tool | Description |
|------|-------------|
| `mail__get_unread` | Get unread message count and summaries |
| `mail__list_messages` | List recent messages from inbox |
| `mail__get_message` | Get full message content by ID |
| `mail__search_messages` | Search across INBOX, Sent, Drafts, Archive |
| `mail__get_thread` | Get all messages in a thread |
| `mail__send_message` | Send a new email |
| `mail__reply_message` | Reply to a message (preserves threading) |
| `mail__forward_message` | Forward a message to another recipient |
| `mail__mark_message` | Mark as read/unread |
| `mail__star_message` | Star/unstar a message |
| `mail__delete_message` | Permanently delete a message |
| `mail__move_message` | Move to a different folder |
| `mail__list_folders` | List all mail folders |
| `mail__list_folder_messages` | List messages in a specific folder |
| `mail__get_attachments` | Download message attachments |

### Pass (9 tools)

| Tool | Description |
|------|-------------|
| `pass__list_vaults` | List available Proton Pass vaults |
| `pass__list_items` | List items in a vault (no passwords shown) |
| `pass__search_items` | Search items by keyword (no passwords shown) |
| `pass__get_item` | Get full credential (username, password, URLs) |
| `pass__create_item` | Store a new login credential |
| `pass__update_item` | Update an existing credential |
| `pass__trash_item` | Move an item to trash |
| `pass__get_totp` | Generate current TOTP code for 2FA |
| `pass__generate_password` | Generate a secure random password |

### Drive (6 tools)

| Tool | Description |
|------|-------------|
| `drive__list` | List files and folders |
| `drive__download` | Download a file |
| `drive__upload` | Upload a file |
| `drive__upload_folder` | Upload an entire folder |
| `drive__mkdir` | Create a directory |
| `drive__delete` | Delete a file or folder |

### Calendar (5 tools)

| Tool | Description |
|------|-------------|
| `calendar__list_events` | List upcoming events |
| `calendar__get_event` | Get event details |
| `calendar__create_event` | Create a new event |
| `calendar__update_event` | Update an existing event |
| `calendar__delete_event` | Delete an event |

### VPN (1 tool)

| Tool | Description |
|------|-------------|
| `vpn__status` | Check Proton VPN connection status |

## Security Notes

- **Proton Bridge password** is NOT your Proton account password — it's a Bridge-specific IMAP/SMTP password
- **pass__list_items** and **pass__search_items** never expose passwords or TOTP seeds
- Only **pass__get_item** returns the actual password — use it deliberately
- The `.env` file contains credentials — keep it out of version control

## License

MIT — see [LICENSE](LICENSE)

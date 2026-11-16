# PipeWire Audio Control for OpenDeck

A Stream Deck plugin for controlling PipeWire audio on Linux via [OpenDeck](https://github.com/ninjadev64/OpenDeck).

## Features

- **Master Volume** - Increase, decrease, and mute system audio
- **Microphone Control** - Increase, decrease, and mute the default mic input
- **Per-App Audio** - Control volume and mute for individual applications
- **Steam Game Audio** - Control volume and mute for whichever Steam game is currently running, detected automatically
- **Output Device Control** - Select a specific output sink and control its volume/mute independently
- **Input Device Control** - Select a specific input source and control its volume/mute independently
- **Device Switching** - Assign a button to any output or input device; press to set it as the system default. Active device shows a green bar, inactive shows grey.
- **Configurable Volume Step** - Per-action slider (1--20%) controls how much each button press or dial tick changes volume
- **Encoder Support** - Dial rotation for volume adjustment (step multiplied by ticks), press/touch to toggle mute or switch default device
- **Real-time Feedback** - Live volume bars and device names on button/encoder screens, updated automatically when PipeWire state changes

## Requirements

- Linux with [PipeWire](https://pipewire.org/) and [WirePlumber](https://pipewire.pages.freedesktop.org/wireplumber/)
- [OpenDeck](https://github.com/ninjadev64/OpenDeck) >= 2.0
- Node.js
- System tools: `wpctl`, `pactl`, `pw-dump`

## Building

```bash
./build.sh
```

Installs dependencies and produces `builds/com.sfgrimes.pipewire-audio.streamDeckPlugin`, which can be installed through OpenDeck.

## Actions

| Action | Description |
|--------|-------------|
| Volume Up / Down | Adjust master output volume |
| Mute Toggle | Toggle master output mute |
| Mic Up / Down | Adjust default microphone volume |
| Mic Mute | Toggle default microphone mute |
| App Volume Up / Down | Adjust a specific app's volume |
| App Mute | Toggle a specific app's mute state |
| Steam Game Volume | Adjust or mute the currently running Steam game |
| Output Volume Up / Down | Adjust a specific output device's volume |
| Output Mute | Toggle a specific output device's mute state |
| Input Volume Up / Down | Adjust a specific input device's volume |
| Input Mute | Toggle a specific input device's mute state |
| Switch Output Device | Set a specific output device as the system default |
| Switch Input Device | Set a specific input device as the system default |

All actions support both keypad (button) and encoder (dial) controllers. The volume step size is configurable per action from the property inspector.

## Steam Game Volume

The **Steam Game Volume** action follows whichever Steam game is running, so one button or dial works for every game without reconfiguring it.

- Games are detected through the `SteamAppId` / `SteamGameId` environment variables that Steam passes to everything it launches (native Linux and Proton games, plus non-Steam shortcuts launched through Steam). Each PipeWire audio stream's owning process is checked; if those variables are missing, the process's parents are searched for Steam's `reaper SteamLaunch AppId=...` launcher.
- The game's name comes from the `appmanifest_<id>.acf` file in your Steam libraries (native, Flatpak and Snap installs are searched). If no manifest is found, the audio stream's application name is shown instead.
- A game is only detected once it opens an audio stream. Until then the key shows **No Game**.
- All of the game's audio streams are adjusted together. If more than one game is producing audio, the one that most recently opened a stream is controlled.

## Setting Up Virtual Sinks

Virtual sinks are useful for routing audio from specific applications to different outputs. For example, you can send game audio to your headphones and music to your speakers, then control each independently with the Output Volume actions.

### Create the sink script

Create `~/.config/pipewire/systemd/sinks.sh` (and the directory if it does not exist):

```bash
#!/usr/bin/env bash

sinks=("Chat" "Browser" "Game" "Media" "System")

for sink in "${sinks[@]}"; do
    pactl load-module module-null-sink \
        sink_name="$sink" \
        sink_properties="device.description=$sink"
done
```

Edit the `sinks` array to add, remove, or rename sinks as needed. Make the script executable:

```bash
chmod +x ~/.config/pipewire/systemd/sinks.sh
```

### Create a systemd user service

Create `~/.config/systemd/user/pipewire-sinks.service`:

```ini
[Unit]
Description=Create custom PipeWire null sinks
After=pipewire.service wireplumber.service
Requires=pipewire.service

[Service]
Type=oneshot
ExecStart=~/.config/pipewire/systemd/sinks.sh
RemainAfterExit=true

[Install]
WantedBy=default.target
```

### Enable and start the service

```bash
systemctl --user daemon-reload
systemctl --user enable --now pipewire-sinks.service
```

The sinks will now be created automatically on login.

### Verify the sinks exist

```bash
wpctl status
```

The virtual sinks should appear under "Audio > Sinks". You can also confirm with:

```bash
pactl list sinks short
```

### Route applications to virtual sinks

Use `pavucontrol`, `pwvucontrol`, or your desktop environment's sound settings to assign applications to the desired virtual sink. Once an application is routed to a virtual sink, you can use the **Output Volume** actions in this plugin to control that sink's volume from your Stream Deck.

### Use with the plugin

1. Add an **Output Volume Up**, **Output Volume Down**, or **Output Mute** action to your Stream Deck.
2. Open the action's property inspector and select the virtual sink from the device dropdown.
3. The button/dial will now control that specific sink's volume and mute state.

You can also use **Switch Output Device** actions to quickly change your system default between physical and virtual sinks.

## License

GNU General Public License v3.0 -- see [LICENSE](LICENSE) for details.

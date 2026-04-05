export type Platform = 'wsl' | 'macos' | 'linux-x11' | 'linux-wayland' | 'windows-bash' | 'unknown';

export function detectPlatform(): Platform {
  if (process.env.MSYSTEM) {
    return 'windows-bash';
  }
  if (process.env.WSL_DISTRO_NAME) {
    return 'wsl';
  }
  if (process.platform === 'darwin') {
    return 'macos';
  }
  if (process.platform === 'linux') {
    if (process.env.WAYLAND_DISPLAY) {
      return 'linux-wayland';
    }
    return 'linux-x11';
  }
  return 'unknown';
}

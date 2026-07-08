import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.speedbattle.ai',
  appName: 'Speed Battle AI',
  webDir: 'dist',
  // Served as https://localhost inside the WebView -> secure context, so
  // getUserMedia works exactly like in the browser.
  server: {
    androidScheme: 'https',
  },
}

export default config

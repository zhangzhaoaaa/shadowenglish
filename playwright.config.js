export default {
  testDir: 'e2e',
  timeout: 60000,
  use: {
    headless: true,
    video: 'off'
  },
  reporter: [['list']]
}

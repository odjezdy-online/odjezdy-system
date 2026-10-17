// Stand-in for arch/'s odjezdy-install (same JSON contract), for testing the installer screens anywhere:
//   ODJEZDY_INSTALL_CMD="node tools/mock-install.js" node app/board.js --png out.png --install
//   MOCK_FAIL=1 makes the run fail in the pacstrap stage.
const args = process.argv.slice(2);
if (args.includes('--list-disks')) {
  console.log(JSON.stringify({ disks: [
    { name: '/dev/sda', size_bytes: 3.9e9, model: 'QEMU HARDDISK', removable: false, has_partitions: false, has_os: false, is_live_medium: false, mode: 'uefi' },
    { name: '/dev/sdb', size_bytes: 256e9, model: 'Samsung SSD 870', removable: false, has_partitions: true, has_os: true, is_live_medium: false, mode: 'uefi' },
    { name: '/dev/sdc', size_bytes: 32e9, model: 'SanDisk Ultra USB', removable: true, has_partitions: true, has_os: false, is_live_medium: true, mode: 'uefi' },
  ] }));
  process.exit(0);
}
const steps = [['partition', 0.03, 'Vytvářím oddíly'], ['format', 0.1, 'Formátuji ext4 a EFI'], ['pacstrap', 0.3, 'Instaluji balíčky (60 z 391)'],
  ['pacstrap', 0.6, 'Instaluji balíčky (240 z 391)'], ['bootloader', 0.85, 'GRUB (UEFI)'], ['config', 0.95, 'Kopíruji nastavení tabule a Wi-Fi'], ['done', 1, 'Hotovo']];
let i = 0;
const tick = setInterval(() => {
  const [stage, progress, message] = steps[i++];
  if (process.env.MOCK_FAIL && stage === 'pacstrap' && progress > 0.5) {
    console.log(JSON.stringify({ error: 'pacstrap: nedostatek místa na disku', stage }));
    clearInterval(tick); process.exit(1);
  }
  console.log(JSON.stringify({ stage, progress, message }));
  if (stage === 'done') { clearInterval(tick); process.exit(0); }
}, Number(process.env.MOCK_STEP_MS) || 400);

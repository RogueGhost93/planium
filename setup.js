/**
 * Modul: Setup-Script
 * Zweck: Erstmalige Einrichtung — ersten Admin-User anlegen.
 *        Wird einmalig nach dem ersten Start ausgeführt: `node setup.js`
 * Abhängigkeiten: server/db.js, bcrypt, dotenv
 */

'use strict';

require('dotenv').config();
const readline = require('node:readline');
const bcrypt = require('bcrypt');
const db = require('./server/db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let password = '';
    process.stdin.on('data', function handler(char) {
      char = char.toString();
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log('\n=== Oikos Setup ===\n');

  // Datenbank initialisieren
  db.init();

  // Prüfen ob bereits Admin vorhanden
  const existingAdmin = db.get()
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get();

  if (existingAdmin) {
    console.log('ℹ  Es existiert bereits ein Admin-Account.\n');
    const proceed = await prompt('Trotzdem einen weiteren Admin anlegen? (j/N): ');
    if (proceed.toLowerCase() !== 'j') {
      console.log('Setup abgebrochen.');
      rl.close();
      process.exit(0);
    }
  }

  console.log('Admin-Account anlegen:\n');

  const username = (await prompt('Benutzername: ')).trim();
  if (!username || username.length < 3) {
    console.error('Fehler: Benutzername muss mindestens 3 Zeichen lang sein.');
    process.exit(1);
  }

  const displayName = (await prompt('Anzeigename (z.B. "Max Mustermann"): ')).trim();
  if (!displayName) {
    console.error('Fehler: Anzeigename darf nicht leer sein.');
    process.exit(1);
  }

  const password = await promptPassword('Passwort: ');
  if (password.length < 8) {
    console.error('Fehler: Passwort muss mindestens 8 Zeichen lang sein.');
    process.exit(1);
  }

  const passwordConfirm = await promptPassword('Passwort bestätigen: ');
  if (password !== passwordConfirm) {
    console.error('Fehler: Passwörter stimmen nicht überein.');
    process.exit(1);
  }

  const avatarColors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#FF2D55'];
  const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];

  console.log('\nAccount wird erstellt …');

  const hash = await bcrypt.hash(password, 12);

  try {
    const result = db.get()
      .prepare(`
        INSERT INTO users (username, display_name, password_hash, avatar_color, role)
        VALUES (?, ?, ?, ?, 'admin')
      `)
      .run(username, displayName, hash, avatarColor);

    console.log(`\n✓ Admin-Account erstellt (ID: ${result.lastInsertRowid})`);
    console.log(`  Benutzername: ${username}`);
    console.log(`  Anzeigename:  ${displayName}`);
    console.log(`  Rolle:        admin`);
    console.log('\nDu kannst dich jetzt unter /login anmelden.\n');
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      console.error(`\nFehler: Benutzername "${username}" ist bereits vergeben.`);
    } else {
      console.error('\nFehler beim Erstellen:', err.message);
    }
    process.exit(1);
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unerwarteter Fehler:', err.message);
  process.exit(1);
});

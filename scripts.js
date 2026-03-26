// scripts.js
// Autocompletar campos si hay datos guardados
document.addEventListener('DOMContentLoaded', () => {
  const savedUser = localStorage.getItem('username');
  const savedMaster = localStorage.getItem('masterKey');
  if (savedUser) {
    const userInput = document.getElementById('user');
    if (userInput) userInput.value = savedUser;
  }
  if (savedMaster) {
    const masterInput = document.getElementById('master');
    if (masterInput) masterInput.value = savedMaster;
  }
});

function togglePassword() {
  const input = document.getElementById('master');
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
}

async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generatePassword() {
  let service = document.getElementById('service').value.trim().toLowerCase();
  let user = document.getElementById('user').value.trim().toLowerCase();
  const master = document.getElementById('master').value;

  // Guardar usuario y clave maestra en localStorage
  localStorage.setItem('username', user);
  localStorage.setItem('masterKey', master);

  if (!service || !user || !master) {
    // Marcar campos vacios
    ['service', 'user', 'master'].forEach(id => {
      const el = document.getElementById(id);
      if (!el.value.trim()) {
        el.classList.add('border-red-400', 'ring-2', 'ring-red-100');
        el.addEventListener('input', () => {
          el.classList.remove('border-red-400', 'ring-2', 'ring-red-100');
        }, { once: true });
      }
    });
    return;
  }

  const combined = `${service}:${user}:${master}`;
  const hash = await sha256(combined);

  const specials = '!@#$%^&*()-_=+[]{};:,.<>?';
  let password = '';
  for (let i = 0; i < 16; i++) {
    const hexPair = hash.substr(i * 4, 4);
    const num = parseInt(hexPair, 16);
    if (i % 4 === 0) {
      password += String.fromCharCode(65 + (num % 26));
    } else if (i % 4 === 1) {
      password += String.fromCharCode(97 + (num % 26));
    } else if (i % 4 === 2) {
      password += String.fromCharCode(48 + (num % 10));
    } else {
      password += specials[num % specials.length];
    }
  }

  const resultDiv = document.getElementById('result');
  const resultText = document.getElementById('resultText');
  resultText.textContent = password;
  resultDiv.classList.remove('hidden');
}

async function copyPassword() {
  const password = document.getElementById('resultText').textContent;
  await navigator.clipboard.writeText(password);

  const copyIcon = document.getElementById('copyIcon');
  const checkIcon = document.getElementById('checkIcon');
  copyIcon.classList.add('hidden');
  checkIcon.classList.remove('hidden');

  setTimeout(() => {
    copyIcon.classList.remove('hidden');
    checkIcon.classList.add('hidden');
  }, 2000);
}

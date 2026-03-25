const firebaseConfig = {
    apiKey: "AIzaSyBBMGdORhteEe1QtQqBQIaiOq6NWe5eJfE",
    authDomain: "bookify-extension.firebaseapp.com",
    projectId: "bookify-extension",
    storageBucket: "bookify-extension.firebasestorage.app",
    messagingSenderId: "882791110164",
    appId: "1:882791110164:web:ee21a39f638bb7ff247901"
};

firebase.initializeApp(firebaseConfig);
export const auth = firebase.auth();
export const db = firebase.firestore();

export function setupAuthUI(state, onUserChange) {
    const loginBtn = document.getElementById('google-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userEmail = document.getElementById('user-email');

    loginBtn.addEventListener('click', () => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                const msg = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No token received';
                alert(`Login failed: ${msg}`);
                return;
            }

            const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
            auth.signInWithCredential(credential).catch((error) => {
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/duplicate-raw-id') {
                    chrome.identity.removeCachedAuthToken({ token }, () => {
                        alert("Authentication error. Please try again.");
                    });
                } else {
                    alert(`Firebase Login Error: ${error.message}`);
                }
            });
        });
    });

    logoutBtn.addEventListener('click', () => auth.signOut());

    auth.onAuthStateChanged(async (user) => {
        state.currentUser = user || null;
        if (user) {
            userEmail.innerText = user.email || 'Logged in';
            loginBtn.classList.add('hidden');
            logoutBtn.classList.remove('hidden');
        } else {
            userEmail.innerText = 'Guest mode';
            loginBtn.classList.remove('hidden');
            logoutBtn.classList.add('hidden');
        }
        await onUserChange(user);
    });
}

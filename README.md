# 📌 Bookify – AI-Powered Bookmark Manager (Chrome Extension)

## 🚀 Overview

**Bookify** is a Chrome extension designed to intelligently organize and manage bookmarks. It combines local-first storage, optional cloud sync, and AI-powered categorization to provide a seamless bookmarking experience.

---

## ✨ Features

### 🔹 Core Functionality

* 📂 **Bookmark Management** – Save, organize, and access bookmarks easily
* 🏷️ **Categories & Tags** – Structure bookmarks with custom categories and tags
* 🔍 **Real-time Search** – Quickly find bookmarks

### 🔹 Offline-First Design

* Works completely without login
* Uses **Chrome Storage APIs** for local persistence

### 🔹 Optional Cloud Sync

* Login with Google (Firebase Auth)
* Sync bookmarks using **Firestore**

### 🔹 AI-Powered Categorization

* Uses **Google Gemini API**
* Automatically assigns categories & tags
* Runs only when API key is provided (optional feature)

### 🔹 Private Vault 🔐

* Secure bookmark storage
* PIN-based access
* Reset option available (clears vault data)

---

## 🧠 Architecture

The extension follows a **modular structure**:

```
popup/
  ├── main.js        # Entry point & UI handling
  ├── state.js       # Global state management
  ├── auth.js        # Firebase authentication (optional)
  ├── storage.js     # Local + cloud storage logic
  ├── ai.js          # Gemini API integration
```

---

## ⚙️ Tech Stack

* **Frontend:** JavaScript (ES Modules), HTML, CSS
* **Browser APIs:** Chrome Extension APIs
* **Storage:** Chrome Local Storage
* **Backend (Optional):** Firebase Firestore
* **Authentication (Optional):** Firebase Auth
* **AI Integration:** Google Gemini API

---

## 🛠️ Installation

1. Clone the repository:

```bash
git clone https://github.com/jaivarun47/bookify-extension.git
```

2. Open Chrome and go to:

```
chrome://extensions/
```

3. Enable **Developer Mode**

4. Click **Load unpacked** and select the project folder

---

## ⚡ Usage

* Open extension from Chrome toolbar
* Add bookmarks and organize them into categories
* Use search for quick access
* (Optional) Login for cloud sync
* (Optional) Add Gemini API key for AI categorization

---

## 🔐 Security Notes

* Vault data is stored locally
* PIN protects access to sensitive bookmarks
* No mandatory authentication required

---

## 🚧 Future Improvements

* Encrypted local storage for vault
* Better UI/UX refinements
* Undo functionality for deletions
* Advanced filtering & sorting

---

## 📌 Key Highlights

* Offline-first architecture
* Modular and scalable design
* Optional AI integration
* Secure vault system

---

## 👨‍💻 Author

**Jai Varun**

---

## ⭐ If you like this project

Give it a star on GitHub ⭐

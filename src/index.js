import JsSIP from "jssip";

window.addEventListener("DOMContentLoaded", loadUserDataAndAuthorize);
document.querySelector("main").style.display = "none";

let callStartTime; // Время начала звонка
let callDurationInterval; // Идентификатор интервала, который используется для обновления длительности звонка.
const callButton = document.getElementById("callButton");
const remoteAudio = document.getElementById("remoteAudio");

const options = {
  mediaConstraints: { audio: true, video: false },
};

async function saveUserData(username, server, password) {
  const userData = {
    username: username,
    server: server,
    password: password,
  };
  await chrome.storage.session.set({ userData: userData });
}

// Функция для загрузки данных пользователя из хранилища и автоматической авторизации
async function loadUserDataAndAuthorize() {
  await chrome.storage.session.get("userData", function (data) {
    const userData = data.userData;
    if (userData) {
      document.getElementById("loginForm").style.display = "none";
      document.querySelector("main").style.display = "";
      loadCallHistory(userData.username);
      document.getElementById("username").value = userData.username;
      document.getElementById("server").value = userData.server;
      document.getElementById("password").value = userData.password;
      document.getElementById("loginForm").dispatchEvent(new Event("submit"));
    }
  });
}

// Функция для сохранения истории звонков в storage
async function saveCallHistory(username, number) {
  try {
    let data = await chrome.storage.local.get(username);
    let userCallHistory = data[username] || [];
    userCallHistory.unshift(number);
    if (userCallHistory.length > 10) {
      userCallHistory.pop();
    }
    let newData = {};
    newData[username] = userCallHistory;
    await chrome.storage.local.set(newData);
    loadCallHistory(username);
  } catch (error) {
    console.error("Ошибка сохранения историй:", error);
  }
}

// Функция для загрузки истории звонков из storage и отображения на странице
async function loadCallHistory(username) {
  try {
    let data = await chrome.storage.local.get(username);
    let userCallHistory = data[username] || [];
    let historyList = document.getElementById("callHistory");
    historyList.innerHTML = "";
    userCallHistory.forEach((number) => {
      let listItem = document.createElement("li");
      listItem.textContent = number;
      listItem.addEventListener("click", () => {
        document.getElementById("phoneNumberInput").value = number;
      });
      historyList.appendChild(listItem);
    });
  } catch (error) {
    console.error("Ошибка загрузки историй:", error);
  }
}

// Функция расчета длительности звонка
function updateCallDuration() {
  const currentTime = Date.now();
  const duration = Math.floor((currentTime - callStartTime) / 1000); // Миллисекунды в секунды
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  document.getElementById("timer").innerText = `Длительность звонка: ${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
// Функция для привязки удаленного потока к аудиоэлементу
function attachRemoteStream(session) {
  session.connection.ontrack = (event) => {
    if (event.track.kind === "audio") {
      if (event.streams.length > 0) {
        remoteAudio.srcObject = event.streams[0];
      } else {
        const stream = new MediaStream([event.track]);
        remoteAudio.srcObject = stream;
      }
    }
  };
}

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const { username, password, server } = Object.fromEntries(formData.entries());

  const socket = new JsSIP.WebSocketInterface(`wss://${server}`);
  const configuration = {
    sockets: [socket],
    uri: `sip:${username}@${server}`,
    password,
  };
  let ua = new JsSIP.UA(configuration);

  ua.start();

  document.getElementById("callButton").addEventListener("click", makeCall);

  // Функция для инициализации звонка
  function makeCall() {
    let phoneNumberInput = document.getElementById("phoneNumberInput").value;
    let session = ua.call(`sip:${phoneNumberInput}@voip.uiscom.ru`, options);
    let audioStream;
    session.connection.ontrack = (event) => {
      if (event.track.kind === "audio") {
        if (event.streams.length > 0) {
          audioStream = event.streams[0];
        } else {
          const stream = new MediaStream([event.track]);
          audioStream = stream;
        }
      }
    };
    session.on("accepted", function () {
      remoteAudio.srcObject = audioStream;
    });
    session.on("ended", function () {
      remoteAudio.srcObject = null;
    });
    session.on("failed", function () {
      remoteAudio.srcObject = null;
    });
  }

  ua.on("disconnected", function (e) {
    if (!ua.isRegistered()) {
      ua.stop();
    }
  });

  ua.on("registered", function (e) {
    document.getElementById("loginForm").style.display = "none";
    document.querySelector("main").style.display = "";
    saveUserData(username, server, password);
    loadCallHistory(username);
  });

  ua.on("unregistered", function (e) {
    document.getElementById("loginForm").style.display = "";
  });
  ua.on("registrationFailed", function (e) {
    console.log("registrationFailed", e.cause);
  });

  ua.on("newRTCSession", ({ request, session }) => {
    // Функция сброса звонка
    function resetCall() {
      session.terminate();
    }

    // Функция для обновления статуса звонка на странице
    function updateUICallStatus(status) {
      document.getElementById("callStatus").innerText = status;
    }

    // Функция для обновления интерфейса страницы во время активного звонка
    function updateUIForCallInProgress() {
      document.getElementById("callingTo").style.display = "";
      callButton.textContent = "Сбросить";
      callButton.removeEventListener("click", makeCall);
      callButton.addEventListener("click", resetCall);
    }

    // Функция для обновления интерфейса страницы по завершению звонка
    function updateUIForCallEnd() {
      clearInterval(callDurationInterval);
      document.getElementById("timer").style.display = "none";
      document.getElementById("callingTo").style.display = "none";
      callButton.style.display = "";
      document.getElementById("acceptButton")?.remove();
      document.getElementById("rejectButton")?.remove();
      callButton.textContent = "Позвонить";
      callButton.removeEventListener("click", resetCall);
      callButton.addEventListener("click", makeCall);
      setTimeout(() => {
        updateUICallStatus("Статус: в ожидании звонка");
      }, 1000);
    }

    session.on("peerconnection", (e) => {
      attachRemoteStream(session);
    });

    session.on("sending", (e) => {
      let uri = request.to.uri.user;
      updateUICallStatus(`Статус: набор номера`);
      document.getElementById("callingTo").innerText = `Звоним: ${uri}`;
      updateUIForCallInProgress();
      saveCallHistory(username, uri);
      document.getElementById("outgoingRingtone").play();
    });

    session.on("accepted", (e) => {
      callStartTime = session.start_time;
      callButton.style.display = "";
      updateUICallStatus("Статус: разговор");
      updateUIForCallInProgress();
      document.getElementById("outgoingRingtone").pause();
      callDurationInterval = setInterval(() => {
        updateCallDuration();
        document.getElementById("timer").style.display = "";
      }, 1000);
    });

    session.on("ended", (e) => {
      updateUICallStatus("Статус: завершен");
      updateUIForCallEnd();
      setTimeout(() => {
        updateUICallStatus("Статус: в ожидании звонка");
      }, 1000);
    });

    session.on("failed", (e) => {
      updateUICallStatus(`Статус: ${e.cause}`);
      document.getElementById("outgoingRingtone").pause();
      document.getElementById("incomingRingtone").pause();
      updateUIForCallEnd();
      setTimeout(() => {
        updateUICallStatus("Статус: в ожидании звонка");
      }, 1000);
    });

    if (session.direction === "incoming") {
      let uri = request.from.uri.user;
      document.getElementById("incomingRingtone").play();
      saveCallHistory(username, uri);
      updateUICallStatus(`Статус: входящий звонок`);
      callButton.style.display = "none";
      document.getElementById("callingTo").style.display = "";
      document.getElementById("callingTo").innerText = `Звонит: ${uri}`;

      const acceptButton = document.createElement("button");
      acceptButton.textContent = "Принять";
      acceptButton.setAttribute("id", "acceptButton");

      const rejectButton = document.createElement("button");
      rejectButton.textContent = "Отклонить";
      rejectButton.setAttribute("id", "rejectButton");

      const phoneNumberInputDiv = document.querySelector(
        "div > label[for='phoneNumberInput']"
      ).parentElement;
      const callHistory = document.getElementById("callHistory");

      phoneNumberInputDiv.parentNode.insertBefore(acceptButton, callHistory);
      phoneNumberInputDiv.parentNode.insertBefore(rejectButton, callHistory);

      acceptButton.addEventListener("click", () => {
        session.answer();
        document.getElementById("incomingRingtone").pause();
        acceptButton.remove();
        rejectButton.remove();
      });

      rejectButton.addEventListener("click", () => {
        session.terminate();
        document.getElementById("incomingRingtone").pause();
        acceptButton.remove();
        rejectButton.remove();
      });
    }
  });
  ua.on("connected", function (e) {
    console.log("работает");
  });
});

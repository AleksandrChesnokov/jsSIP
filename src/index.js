import JsSIP from "jssip";

document.querySelector("main").style.display = "none";

let callStartTime; // Время начала звонка
let callDurationInterval; // Идентификатор интервала, который используется для обновления длительности звонка.
const callButton = document.getElementById("callButton");
const remoteAudio = document.getElementById("remoteAudio");

const options = {
  mediaConstraints: { audio: true, video: false },
};

// Функция для сохранения истории звонков в storage
async function saveCallHistory(username, number) {
  try {
    let data = await chrome.storage.session.get(username);
    let userCallHistory = data[username] || [];
    userCallHistory.unshift(number);
    if (userCallHistory.length > 10) {
      userCallHistory.pop();
    }
    let newData = {};
    newData[username] = userCallHistory;
    await chrome.storage.session.set(newData);
    loadCallHistory(username);
  } catch (error) {
    console.error("Ошибка сохранения историй:", error);
  }
}

// Функция для загрузки истории звонков из storage и отображения на странице
async function loadCallHistory(username) {
  try {
    let data = await chrome.storage.session.get(username);
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
    attachRemoteStream(session);
  }

  ua.on("disconnected", function (e) {
    if (!ua.isRegistered()) {
      ua.stop();
    }
  });

  ua.on("registered", function (e) {
    document.getElementById("loginForm").style.display = "none";
    document.querySelector("main").style.display = "";
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
    // Входящий звонок
    if (session.direction === "incoming") {
      let uri = request.from.uri.user;
      saveCallHistory(username, uri);
      document.getElementById("incomingRingtone").play();
      updateUICallStatus(`Статус: входящий звонок`);
      document.getElementById("callingTo").style.display = "";
      document.getElementById("callingTo").innerText = `Звонит: ${uri}`;
      setTimeout(() => {
        const confirmed = confirm("Входящий вызов. Принять звонок?");
        if (confirmed) {
          session.answer();
          document.getElementById("incomingRingtone").pause();
        } else {
          session.terminate();
          document.getElementById("incomingRingtone").pause();
        }
      }, 0);
    }
  });
  ua.on("connected", function (e) {
    console.log("работает");
  });
});

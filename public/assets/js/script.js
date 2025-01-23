let connections = [];
const sun = document.querySelector(".sun");
const moon = document.querySelector(".moon");

// Load the saved theme from local storage
let currentThemeSetting = localStorage.getItem("theme") || "light";
document.querySelector("html").setAttribute("data-theme", currentThemeSetting);
(currentThemeSetting === "dark" ? sun : moon).classList.add("visible");

document.getElementById("darkModeToggle").addEventListener("click", () => {
  const newTheme = currentThemeSetting === "dark" ? "light" : "dark";

  document.querySelector("html").setAttribute("data-theme", newTheme);

  localStorage.setItem("theme", newTheme);
  currentThemeSetting = newTheme;

  sun.classList.toggle("visible");
  moon.classList.toggle("visible");
});

const ws = new WebSocket("ws://localhost:8080");

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // toastr.info(data.message, data.title);
  document.querySelector(".main-container").classList.add("active");
  addNotification(data.title, data.message);
};

function addNotification(title, message) {
  const container = document.getElementById("notificationContainer");

  const card = document.createElement("div");
  card.className = "notification-card";

  card.innerHTML = `
      <h4>${title}</h4>
      <p>${message}</p>
    `;

  container.insertBefore(card, container.firstChild);

  container.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

async function loadSavedConnections() {
  try {
    const response = await fetch("/load-connections");
    connections = await response.json();
    const selectElement = document.getElementById("savedConnections");

    selectElement.innerHTML = '<option value="">Create a new one</option>';

    connections.forEach((connection, index) => {
      const option = document.createElement("option");
      option.value = index;
      option.textContent = connection.name || `Connection ${index + 1}`;
      selectElement.appendChild(option);
    });

    document.getElementById("uid").value = generateUniqueId();
  } catch (error) {
    console.error("Error loading connections:", error);
  }
}

document
  .getElementById("savedConnections")
  .addEventListener("change", (event) => {
    const selectedIndex = event.target.value;
    if (selectedIndex !== "" && connections[selectedIndex]) {
      const selectedConnection = connections[selectedIndex];
      document.getElementById("uid").value =
        selectedConnection.uid || generateUniqueId();
      document.getElementById("name").value = selectedConnection.name || "";
      document.getElementById("connectionType").value =
        selectedConnection.CONNECTION_TYPE || "";
      document.getElementById("host").value = selectedConnection.HOST || "";
      document.getElementById("port").value = selectedConnection.PORT || "";
      document.getElementById("user").value = selectedConnection.USER || "";
      document.getElementById("password").value =
        selectedConnection.PASSWORD || "";
      document.getElementById("localDir").value =
        selectedConnection.LOCAL_DIR || "";
      document.getElementById("remoteDir").value =
        selectedConnection.REMOTE_DIR || "";
      document.getElementById("useGitignore").checked =
        selectedConnection.USE_GITIGNORE === "true";
      document.getElementById("useNodeNotifier").checked =
        selectedConnection.USE_NODENOTIFIER === "on";
      document.getElementById("retryAttempts").value =
        selectedConnection.RETRY_ATTEMPTS || "";
      document.getElementById("retryDelay").value =
        selectedConnection.RETRY_DELAY || "";
      document.getElementById("connectionTimeout").value =
        selectedConnection.CONNECTION_TIMEOUT || "";
    } else {
      document.getElementById("envForm").reset();
      document.getElementById("uid").value = generateUniqueId();
    }
  });

window.onload = loadSavedConnections;

function generateUniqueId(length = 5) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

document.getElementById("envForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(event.target);

  const config = {};
  formData.forEach((value, key) => {
    config[key] =
      key === "USE_GITIGNORE"
        ? event.target[key].checked
          ? "true"
          : "false"
        : value;
  });

  // Save new connection
  try {
    // Send config to the server for saving
    const response = await fetch("http://localhost:4000/save-connection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    });

    if (response.ok) {
      toastr.success("Configuration updated successfully!", "Nice!");
      event.target.reset();
      loadSavedConnections(); // Reload saved connections
    } else {
      toastr.error("Failed to update configuration.", "Error!");
    }
  } catch (error) {
    console.error("Error:", error);
    toastr.error(
      "An error occurred while updating the configuration.",
      "Error!"
    );
  }
});

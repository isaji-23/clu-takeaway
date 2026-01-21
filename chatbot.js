let session = {
    order: {
        id: null,
        city: null,
        items: [], // [{product, quantity}]
        datetime: null, // {text, value}
        name: null,
        email: null,
        status: "Draft",
    },
    state: "IDLE", // "IDLE", "COLLECTING", "CONFIRMING"
    expecting: null,
};

// Placeholder quick-test prompts (replace with your real text)
const QUICK_TEST_PROMPTS = {
    placeOrder: "I want 2 burgers and 1 soda in Madrid for tomorrow at 8pm. I am Juan with j@gmail.com as my email.",
    checkStatus: "I want to check the status of my order.",
    cancelOrder: "I want to cancel my order.",
};

let isBotBusy = false;

/* =========================================
   2. DOM ELEMENTS & UI HELPERS
   ========================================= */
const chatHistory = document.getElementById("chat-history");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

// Quick test buttons
const btnQTPlaceOrder = document.getElementById("qt-place-order");
const btnQTCheckStatus = document.getElementById("qt-check-status");
const btnQTCancelOrder = document.getElementById("qt-cancel-order");
const btnQTReset = document.getElementById("qt-reset");

// UI Elements for Order Preview
const elCartList = document.getElementById("cart-list");
const elCity = document.getElementById("display-city");
const elTime = document.getElementById("display-time");
const elName = document.getElementById("display-name");
const elEmail = document.getElementById("display-email");
const elStatusBadge = document.getElementById("order-status-badge");

// ID Elements
const elRowId = document.getElementById("row-order-id");
const elDisplayId = document.getElementById("display-id");

function addMessage(text, sender) {
    const div = document.createElement("div");
    div.className = `message ${sender}-message`;
    div.innerText = text;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function setControlsDisabled(disabled) {
    isBotBusy = disabled;

    // Disable input + send
    userInput.disabled = disabled;
    sendBtn.disabled = disabled;

    // Disable quick-test buttons
    if (btnQTPlaceOrder) btnQTPlaceOrder.disabled = disabled;
    if (btnQTCheckStatus) btnQTCheckStatus.disabled = disabled;
    if (btnQTCancelOrder) btnQTCancelOrder.disabled = disabled;
    if (btnQTReset) btnQTReset.disabled = disabled;

    // Optional visual cue (if you added CSS for .bot-busy)
    document.body.classList.toggle("bot-busy", disabled);
}

// Typing indicator helpers
function addTypingIndicator() {
    const typing = document.createElement("div");
    typing.className = "message bot-message";
    typing.innerText = "...";
    typing.dataset.typing = "true";
    chatHistory.appendChild(typing);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return typing;
}

function removeTypingIndicator(typingEl) {
    if (typingEl && typingEl.parentNode)
        typingEl.parentNode.removeChild(typingEl);
}

// --- UI UPDATER ---
function updateUI() {
    const o = session.order;

    // 1. Update Cart
    elCartList.innerHTML = "";
    if (o.items.length === 0) {
        elCartList.innerHTML =
            '<li class="empty-state">Your cart is empty</li>';
    } else {
        o.items.forEach((item) => {
            const li = document.createElement("li");
            li.innerHTML = `
                <span class="cart-item-qty">${item.quantity}x</span>
                <span class="cart-item-name">${item.product}</span>
            `;
            elCartList.appendChild(li);
        });
    }

    // 2. Update Details
    elCity.innerText = o.city || "---";
    elTime.innerText = o.datetime ? o.datetime.text : "---";
    elName.innerText = o.name || "---";
    elEmail.innerText = o.email || "---";

    // 3. Update Order ID (Show/Hide)
    if (o.id) {
        elRowId.style.display = "flex";
        elDisplayId.innerText = o.id;
    } else {
        elRowId.style.display = "none";
    }

    // 4. Update Status Badge
    elStatusBadge.innerText = o.status || "Draft";
    elStatusBadge.className = "badge"; // reset class
    if (o.status === "Confirmed") elStatusBadge.classList.add("confirmed");
    else if (o.status !== "Draft" && o.status !== null)
        elStatusBadge.classList.add("active");
}

/* =========================================
   3. BUSINESS LOGIC & VALIDATION
   ========================================= */

function validateTime(isoString) {
    if (!isoString)
        return { valid: false, msg: "I couldn't detect a valid date." };

    const now = new Date();
    const orderTime = new Date(isoString);
    if (isNaN(orderTime.getTime()))
        return { valid: false, msg: "Invalid date format." };

    const diff = (orderTime - now) / (1000 * 60 * 60);
    if (diff < 0) return { valid: false, msg: "Time must be in the future." };
    if (diff > 48)
        return { valid: false, msg: "Orders can only be 48 hours in advance." };

    return { valid: true };
}

function canCancel(isoString) {
    if (!isoString) return false;
    const now = new Date();
    const orderTime = new Date(isoString);
    return (orderTime - now) / (1000 * 60 * 60) >= 24;
}

/* =========================================
   4. CLU CLIENT
   ========================================= */

async function callCLU(query) {
    const res = await fetch("/api/clu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "CLU proxy error");
    }

    return await res.json();
}

/* =========================================
   5. ENTITY PARSING
   ========================================= */

function extractData(entities) {
    let extracted = {
        city: null,
        datetime: null,
        items: [],
        name: null,
        email: null,
    };

    const isName = (txt) =>
        entities.some(
            (e) =>
                (e.category === "PersonName" || e.category === "Name") &&
                e.text === txt,
        );

    let products = [];
    let quantities = [];

    entities.forEach((ent) => {
        const txt = ent.text;
        const cat = ent.category;

        if (!txt || !cat) return;

        if (cat === "City") {
            if (!isName(txt)) extracted.city = txt;
        } else if (cat === "Location" && !extracted.city) {
            if (!isName(txt)) extracted.city = txt;
        } else if (cat === "Email") extracted.email = txt;
        else if (cat === "PersonName" || cat === "Name") extracted.name = txt;
        else if (cat === "Product")
            products.push({ name: txt, offset: ent.offset ?? 999999 });
        else if (cat === "DateTime") {
            const val =
                ent.resolutions && ent.resolutions[0]
                    ? ent.resolutions[0].value
                    : null;
            extracted.datetime = { text: txt, value: val };
        } else if (cat === "Number") {
            let val =
                ent.resolutions && ent.resolutions[0]
                    ? Number(ent.resolutions[0].value)
                    : Number(txt);
            if (!isNaN(val))
                quantities.push({ val: val, offset: ent.offset ?? 999999 });
        }
    });

    products.forEach((p) => {
        let q = 1;
        let minDist = 1000;
        quantities.forEach((qty) => {
            if (qty.offset < p.offset) {
                const dist = p.offset - qty.offset;
                if (dist < 30 && dist < minDist) {
                    minDist = dist;
                    q = qty.val;
                }
            }
        });
        extracted.items.push({ product: p.name, quantity: q });
    });

    return extracted;
}

/* =========================================
   6. CORE STATE MACHINE
   ========================================= */

function processTurn(intent, entities, rawText) {
    const data = extractData(entities);
    const lowerText = rawText.toLowerCase();

    // --- GLOBAL COMMANDS ---

    // A. CANCELLATION
    if (
        (intent === "CancelOrder" || lowerText.includes("cancel")) &&
        data.items.length === 0
    ) {
        if (session.order.id) {
            const orderDateVal = session.order.datetime
                ? session.order.datetime.value
                : null;
            if (canCancel(orderDateVal)) {
                const oldId = session.order.id;
                resetSession();
                return `Order ${oldId} has been successfully cancelled.`;
            } else {
                return `Sorry, order ${session.order.id} cannot be cancelled. It is less than 24 hours before pickup.`;
            }
        } else if (session.state !== "IDLE") {
            resetSession();
            return "Order process cancelled. How can I help?";
        } else {
            return "You have no active order to cancel.";
        }
    }

    // B. EXIT
    if (intent === "Exit") {
        resetSession();
        return "Session reset. How can I help?";
    }

    // --- STATE: IDLE ---
    if (session.state === "IDLE") {
        if (intent === "CreateOrder") {
            resetSession();
            session.state = "COLLECTING";
            session.order.status = "In Progress";
            mergeData(data, rawText);
            return advanceFlow();
        } else if (intent === "CheckOrderStatus") {
            if (session.order.id) {
                return `Order ${session.order.id} is ${session.order.status}. Pickup in ${session.order.city} at ${session.order.datetime.text}.`;
            } else {
                return "You have no active order. Say 'Order food' to start.";
            }
        } else if (intent === "GetRecommendations") {
            return "Our favorites today are the Pizza, Burgers, and our special Menu deals. Don't forget a Drink or Dessert!";
        } else {
            return "I can help you Order Food, Check Status, or Get Recommendations.";
        }
    }

    // --- STATE: COLLECTING ---
    if (session.state === "COLLECTING") {
        if (session.expecting) {
            fillExpectedSlot(session.expecting, data, rawText);
            session.expecting = null;
        } else {
            mergeData(data, rawText);
        }
        return advanceFlow();
    }

    // --- STATE: CONFIRMING ---
    if (session.state === "CONFIRMING") {
        // 1. DATA DETECTION
        if (
            data.city ||
            data.name ||
            data.email ||
            data.datetime ||
            data.items.length > 0
        ) {
            mergeData(data, rawText);
            return advanceFlow();
        }

        // 1b. FALLBACK ITEM DETECTION
        const itemMatch = rawText.match(
            /(?:add|extra|plus|with)\s+(?:(\d+)\s+)?([a-zA-Z\s]+)/i,
        );
        if (itemMatch) {
            const qty = itemMatch[1] ? parseInt(itemMatch[1]) : 1;
            const prod = itemMatch[2].trim();
            mergeData({ items: [{ product: prod, quantity: qty }] }, rawText);
            return advanceFlow();
        }

        // 2. CONFIRMATION
        if (
            intent === "Affirmation" ||
            lowerText === "yes" ||
            lowerText === "ok"
        ) {
            session.order.id = "ORD-" + Math.floor(Math.random() * 10000);
            session.order.status = "Confirmed";
            session.state = "IDLE";
            return `Great! Order ${session.order.id} is confirmed. See you in ${session.order.city}.`;
        }

        // 3. NEGATION / MODIFY
        else if (
            intent === "Negation" ||
            intent === "ModifyData" ||
            lowerText === "no"
        ) {
            if (lowerText.includes("name")) {
                session.order.name = null;
                return advanceFlow();
            }
            if (lowerText.includes("city")) {
                session.order.city = null;
                return advanceFlow();
            }
            if (lowerText.includes("email")) {
                session.order.email = null;
                return advanceFlow();
            }
            if (lowerText.includes("time") || lowerText.includes("date")) {
                session.order.datetime = null;
                return advanceFlow();
            }
            if (lowerText.includes("item") || lowerText.includes("food")) {
                session.order.items = [];
                return advanceFlow();
            }

            return "What would you like to change? (e.g., 'Change name' or 'Add pizza')";
        }

        return "Please confirm: Yes or No?";
    }

    return "I'm not sure I understood.";
}

// --- HELPER: Merge Data ---
function mergeData(newData, rawText = "") {
    if (newData.city) session.order.city = newData.city;
    if (newData.name) session.order.name = newData.name;
    if (newData.email) session.order.email = newData.email;
    if (newData.datetime) session.order.datetime = newData.datetime;

    const isRemoval = /remove|delete|cancel|minus|take off|no /i.test(rawText);

    if (newData.items && newData.items.length > 0) {
        newData.items.forEach((newItem) => {
            const normNew = newItem.product
                .trim()
                .toLowerCase()
                .replace(/s$/, "");

            const existingIndex = session.order.items.findIndex((i) => {
                const normExisting = i.product
                    .trim()
                    .toLowerCase()
                    .replace(/s$/, "");
                return normExisting === normNew;
            });

            if (existingIndex !== -1) {
                if (isRemoval) {
                    session.order.items[existingIndex].quantity -=
                        newItem.quantity;
                    if (session.order.items[existingIndex].quantity <= 0) {
                        session.order.items.splice(existingIndex, 1);
                    }
                } else {
                    session.order.items[existingIndex].quantity +=
                        newItem.quantity;
                }
            } else {
                if (!isRemoval) {
                    session.order.items.push(newItem);
                }
            }
        });
    }
}

// --- HELPER: Contextual Fill ---
function fillExpectedSlot(slot, data, rawText) {
    if (slot === "city") {
        session.order.city =
            data.city || rawText.replace(/[^\w\s]/gi, "").trim();
    } else if (slot === "items") {
        let itemsToAdd = [];
        if (data.items.length > 0) {
            itemsToAdd = data.items;
        } else {
            itemsToAdd = [{ product: rawText, quantity: 1 }];
        }

        itemsToAdd.forEach((newItem) => {
            const normNew = newItem.product
                .trim()
                .toLowerCase()
                .replace(/s$/, "");

            const existingItem = session.order.items.find((i) => {
                const normExisting = i.product
                    .trim()
                    .toLowerCase()
                    .replace(/s$/, "");
                return normExisting === normNew;
            });

            if (existingItem) {
                existingItem.quantity += newItem.quantity;
            } else {
                session.order.items.push(newItem);
            }
        });
    } else if (slot === "datetime") {
        if (data.datetime) session.order.datetime = data.datetime;
        else session.order.datetime = { text: rawText, value: null };
    } else if (slot === "name") {
        session.order.name =
            data.name || rawText.replace(/my name is|it's|name/gi, "").trim();
    } else if (slot === "email") {
        session.order.email = data.email || rawText.trim();
    }
}

// --- HELPER: Advance Flow ---
function advanceFlow() {
    const o = session.order;

    if (!o.city) {
        session.expecting = "city";
        return "In which city will you pick up the order?";
    }
    if (o.items.length === 0) {
        session.expecting = "items";
        return "What would you like to order? (e.g., 2 Pizzas)";
    }
    if (!o.datetime) {
        session.expecting = "datetime";
        return "When do you want to pick it up? (e.g., Tomorrow at 8pm)";
    }

    const timeCheck = validateTime(o.datetime.value);
    if (!timeCheck.valid) {
        o.datetime = null;
        session.expecting = "datetime";
        return `⚠️ ${timeCheck.msg} Please provide a valid time.`;
    }

    if (!o.name) {
        session.expecting = "name";
        return "What is the name for the order?";
    }
    if (!o.email) {
        session.expecting = "email";
        return "What is your email address?";
    }

    session.state = "CONFIRMING";
    session.expecting = null;

    const itemsStr = o.items
        .map((i) => `\n     - ${i.quantity}x ${i.product}`)
        .join("");
    return `Please Confirm:\n   Name: ${o.name}\n   Email: ${o.email}\n   City: ${o.city}\n   Time: ${o.datetime.text}\n   Items:${itemsStr}\n\nIs this correct? (Yes/No)`;
}

function resetSession() {
    session.order = {
        id: null,
        city: null,
        items: [],
        datetime: null,
        name: null,
        email: null,
        status: "Draft",
    };
    session.state = "IDLE";
    session.expecting = null;
}

/* =========================================
   7. EVENT HANDLERS
   ========================================= */

async function handleSend(textOverride = null) {
    if (isBotBusy) return;

    const text = (textOverride ?? userInput.value).trim();
    if (!text) return;

    addMessage(text, "user");
    userInput.value = "";

    setControlsDisabled(true);
    const typingEl = addTypingIndicator();

    try {
        const apiResponse = await callCLU(text);

        if (apiResponse?.result?.prediction) {
            const pred = apiResponse.result.prediction;
            const reply = processTurn(pred.topIntent, pred.entities, text);
            addMessage(reply, "bot");
        } else {
            addMessage("Sorry, I couldn't understand that.", "bot");
        }

        updateUI();
    } catch (err) {
        console.error(err);
        addMessage("There was an error contacting the service.", "bot");
    } finally {
        removeTypingIndicator(typingEl);
        setControlsDisabled(false);
    }
}

sendBtn.addEventListener("click", () => handleSend());

userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSend();
});

async function sendMessageProgrammatically(text) {
    const msg = (text || "").trim();
    if (!msg) return;
    if (isBotBusy) return;

    // Put it in the input (optional)
    userInput.value = msg;

    // Reuse the same handler
    handleSend(msg);
}

function resetConversationUI() {
    if (isBotBusy) return;

    // Reset internal session
    resetSession();

    // Clear chat history
    chatHistory.innerHTML = "";

    // Add the initial bot message again
    addMessage(
        "Hello! I can help you order food, track an order, or give recommendations.",
        "bot",
    );

    // Clear input
    userInput.value = "";

    // Refresh right-side summary panel
    updateUI();
}

btnQTPlaceOrder?.addEventListener("click", () => {
    sendMessageProgrammatically(QUICK_TEST_PROMPTS.placeOrder);
});

btnQTCheckStatus?.addEventListener("click", () => {
    sendMessageProgrammatically(QUICK_TEST_PROMPTS.checkStatus);
});

btnQTCancelOrder?.addEventListener("click", () => {
    sendMessageProgrammatically(QUICK_TEST_PROMPTS.cancelOrder);
});

btnQTReset?.addEventListener("click", () => {
    resetConversationUI();
});

/* =========================================
   8. INIT
   ========================================= */

// Initial bot message (optional if your HTML already includes one)
if (chatHistory && chatHistory.children.length === 0) {
    addMessage(
        "Hello! I can help you order food, track an order, or give recommendations.",
        "bot",
    );
}
updateUI();

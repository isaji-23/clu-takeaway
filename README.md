# Takeaway Assistant (Azure AI)

## Example Prompts to Try

Here are some test scenarios you can run to see the bot's logic in action:

### **Scenario A: The "One-Shot" Order**

*User provides everything in one go.*

```text
I want 2 burgers and 1 soda in Madrid for tomorrow at 8pm. I am Juan with j@gmail.com as my email.
```
### **Scenario B: Guided Ordering**

*User starts vague, bot guides the rest.*

```text
I want to order food
```
*(Bot will ask for City)* -> `Barcelona`
*(Bot will ask for Items)* -> `2 burgers`
*(Bot will ask for Time)* -> `Tomorrow at 7pm`
*(Bot will ask for Name)* -> `Sam`

### **Scenario C: Modifications**

*You can change anything during the confirmation phase.*

```text
Add 1 pizza
```
```text
Remove 1 burger
```
```text
Change name to Juan
```
```text
Change time to tomorrow at 9pm
```
### **Scenario E: Check status**


```text
I want to check the status
```

### **Scenario D: Cancellation Rules**

*Try to cancel an order.*

```text
Cancel my order```
*(If the order is < 24h away, the bot will refuse. If > 24h away, it will succeed.)*

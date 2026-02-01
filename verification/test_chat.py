import time
from playwright.sync_api import sync_playwright, expect

def test_chat(page):
    print("Navigating to localhost:3000")
    page.goto("http://localhost:3000")

    # Wait for input
    print("Waiting for input")
    input_area = page.get_by_placeholder("What would you like to know?")
    expect(input_area).to_be_visible()

    # Type message
    print("Typing message")
    input_area.fill("What tables are in the database?")

    # Click submit
    print("Clicking submit")
    submit_btn = page.get_by_label("Submit")
    submit_btn.click()

    # Wait for response
    # The response will appear in a message bubble.
    # We can wait for "is-assistant" class or text.
    print("Waiting for response")

    # Wait for at least some text to appear.
    # The agent might take a few seconds.
    # We can look for the 'Response' component content or just any text in the assistant message.
    # Let's wait for a specific text or just wait for the loading state to finish.

    # Assuming the assistant replies with something containing "tables" or "users" or "products".
    # Or we can just wait for the status to go back to ready?
    # But status isn't easily visible unless we check the submit button icon (SquareIcon vs SendIcon).

    # Let's wait for a message bubble from assistant.
    # The assistant message has class "is-assistant".
    # Initially there might be one empty or loading?
    # In useClaudeChat, we add a placeholder immediately.

    # We can wait for the text to be non-empty and maybe contain "sqlite" or table names.
    # Giving it some time.
    time.sleep(10)

    page.screenshot(path="verification/chat_test.png")
    print("Screenshot saved to verification/chat_test.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_chat(page)
        except Exception as e:
            print(f"Test failed: {e}")
            page.screenshot(path="verification/chat_failure.png")
        finally:
            browser.close()

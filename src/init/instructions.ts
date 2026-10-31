export const INSTRUCTIONS = [
  '- 修改檔案前，先用 inloop 的 why 查看該檔案過去的改動紀錄，不要推翻已確認的決定；若必須推翻，在新紀錄中說明原因。',
  '- 每完成一個有意義的改動（一個 Why 一筆），就呼叫 record_change；若取代了既有紀錄，帶上 supersedes。',
  '- 使用者輸入 /inloop.review、/inloop.capture、/inloop.why 時，呼叫對應的 tool；show_review 回傳的 Markdown 要原樣輸出，不要摘要或改寫。',
  '- 使用者說「開確認清單」時呼叫 confirm_list。你不能代替使用者確認任何紀錄。',
  '- 看到疑似拼錯的 InLoop 指令時，提示使用者正確的寫法，不要自行猜測執行。',
].join('\n');

import os
import tkinter as tk
from tkinter import messagebox, filedialog
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi

def select_folder():
    # 폴더 선택 창 띄우기
    folder_selected = filedialog.askdirectory()
    if folder_selected:
        folder_entry.delete(0, tk.END)
        folder_entry.insert(0, folder_selected)

def save_transcript():
    user_input = url_entry.get().strip()
    save_path = folder_entry.get().strip()
    
    if not user_input:
        messagebox.showwarning("입력 오류", "유튜브 주소나 비디오 ID를 입력해주세요.")
        return
    if not save_path:
        messagebox.showwarning("경로 오류", "저장할 폴더를 선택해주세요.")
        return
        
    # URL에서 ID 추출 로직
    video_id = user_input
    if "youtube.com" in user_input or "youtu.be" in user_input:
        try:
            parsed = urlparse(user_input)
            if "youtu.be" in user_input:
                video_id = parsed.path.lstrip("/")
            else:
                query_params = parse_qs(parsed.query)
                video_id = query_params.get("v", [user_input])[0]
        except Exception:
            pass
            
    # 전체 파일 경로 생성 (폴더 경로 + 파일명)
    file_name = f"{video_id}_transcript.txt"
    full_file_path = os.path.join(save_path, file_name)
    
    try:
        # 스크립트 추출 (최신 라이브러리 문법 기준)
        # ※ 만약 계속 AttributeError가 나면 해당 폴더에 youtube_transcript_api.py 파일이 있는지 꼭 확인하세요!
        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['ko', 'en'])
        
        with open(full_file_path, 'w', encoding='utf-8') as f:
            for item in transcript:
                f.write(f"{item['text']}\n")
        
        messagebox.showinfo("완료", f"스크립트가 다음 경로에 저장되었습니다:\n{full_file_path}")
        
    except Exception as e:
        messagebox.showerror("추출 실패", f"오류가 발생했습니다.\n상세 오류: {e}")

# --- GUI 설정 ---
root = tk.Tk()
root.withdraw()
root.title("루비의 유튜브 스크립트 추출기 v2.0")
root.geometry("600x300")
root.configure(bg="#0F172A")  # Dark background

# Style configuration
dark_bg = "#0F172A"
panel_bg = "#111827"
input_bg = "#0B1220"
text_fg = "#E5E7EB"
accent_yellow = "#F59E0B"
accent_yellow_bright = "#FACC15"

# 1. URL 입력 섹션
tk.Label(root, text="1. 유튜브 주소 또는 비디오 ID 입력:", bg=dark_bg, fg=text_fg, font=('nanum', 10, 'bold')).pack(pady=(20, 0))
url_entry = tk.Entry(root, width=60, bg=input_bg, fg=text_fg, insertbackground='white', borderwidth=1, relief="flat")
url_entry.pack(pady=10, ipady=5)

# 2. 폴더 선택 섹션
tk.Label(root, text="2. 저장할 폴더 선택:", bg=dark_bg, fg=text_fg, font=('nanum', 10, 'bold')).pack(pady=(10, 0))
folder_frame = tk.Frame(root, bg=dark_bg)
folder_frame.pack(pady=5)

folder_entry = tk.Entry(folder_frame, width=45, bg=input_bg, fg=text_fg, insertbackground='white', borderwidth=1, relief="flat")
folder_entry.pack(side=tk.LEFT, padx=(0, 10), ipady=5)
# 기본 경로를 현재 실행 폴더로 설정
folder_entry.insert(0, os.getcwd())

folder_btn = tk.Button(folder_frame, text="찾아보기", command=select_folder, 
                       bg="#334155", fg="white", relief="flat", padx=10)
folder_btn.pack(side=tk.LEFT)

# 3. 실행 버튼
exec_btn = tk.Button(root, text="스크립트 추출 및 저장 시작", command=save_transcript, 
                      bg=accent_yellow, fg="#0F172A", font=('nanum', 11, 'bold'), 
                      height=2, relief="flat", activebackground=accent_yellow_bright, cursor="hand2")
exec_btn.pack(pady=30, fill=tk.X, padx=100)

def show_window():
    root.update_idletasks()
    root.deiconify()
    root.lift()
    url_entry.focus_set()

root.after(0, show_window)
root.mainloop()

import qrcode
import pandas as pd
import smtplib
import os
from email.message import EmailMessage
from PIL import Image
from dotenv import load_dotenv

# -------- Load .env file ----------
load_dotenv()

# -------- Fetch from environment ----------
GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")
EXCEL_FILE = os.getenv("EXCEL_FILE", "teams.xlsx")
QR_FOLDER = os.getenv("QR_FOLDER", "generated_qr")
LOGO_PATH = os.getenv("LOGO_PATH")

# -------- Basic validation ----------
if not GMAIL_USER or not GMAIL_APP_PASSWORD:
    raise ValueError("Missing Gmail credentials in .env file")

# -------- Create QR folder ----------
os.makedirs(QR_FOLDER, exist_ok=True)


# -------- QR WITH LOGO FUNCTION ----------
def generate_qr_with_logo(data, logo_path, output_path):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4,
    )

    qr.add_data(data)
    qr.make(fit=True)

    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")

    if logo_path and os.path.exists(logo_path):
        logo = Image.open(logo_path).convert("RGBA")

        qr_width, qr_height = qr_img.size
        logo_size = int(qr_width / 5)
        logo = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)

        logo_pos = ((qr_width - logo_size) // 2,
                    (qr_height - logo_size) // 2)

        qr_img.paste(logo, logo_pos, logo)

    qr_img.save(output_path)


# -------- Safe Filename ----------
def clean_filename(name):
    return "".join(c for c in str(name) if c.isalnum() or c in (" ", "_")).rstrip()


# -------- Read Excel ----------
df = pd.read_excel(EXCEL_FILE)


# -------- Connect SMTP Once (Better Performance) ----------
with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
    smtp.login(GMAIL_USER, GMAIL_APP_PASSWORD)

    for index, row in df.iterrows():

        try:
            team_name = str(row['Team Name'])
            student_name = str(row['Student Name'])
            reg_no = str(row['Registration Number'])
            lead_email = str(row['Email ID(team lead)'])
            member_email = str(row['Email ID(team member)'])

            # QR Data
            qr_data = (
                f"Team Name: {team_name}\n"
                f"Student Name: {student_name}\n"
                f"Registration Number: {reg_no}"
            )

            safe_team_name = clean_filename(team_name)
            qr_filename = f"{QR_FOLDER}/{safe_team_name}_{reg_no}.png"

            generate_qr_with_logo(qr_data, LOGO_PATH, qr_filename)

            msg = EmailMessage()
            msg['Subject'] = f"QR Code - {team_name}"
            msg['From'] = GMAIL_USER
            msg['To'] = ", ".join([lead_email, member_email])

            msg.set_content(f"""
Hello,

Please find attached the QR code for:

Team Name: {team_name}
Student Name: {student_name}
Registration Number: {reg_no}

Kindly do not forget to carry your ID card, laptop, charger, and extension cord for the event.

Regards,
TEAM FYI CLUB
""")

            with open(qr_filename, 'rb') as f:
                msg.add_attachment(
                    f.read(),
                    maintype='image',
                    subtype='png',
                    filename=os.path.basename(qr_filename)
                )

            smtp.send_message(msg)

            print(f"Email sent for {team_name}")

        except Exception as e:
            print(f"Error processing row {index}: {e}")

print("All emails sent successfully!")
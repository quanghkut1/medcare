# MedCare — Dataset

Tài liệu mô tả dữ liệu của đồ án **MedCare — Medical Clinic Operations Management System with AI-Enhanced Decision Support**.

> **Lưu ý kiến trúc:** MedCare là hệ thống quản lý vận hành phòng khám, phần AI sử dụng **mô hình ngôn ngữ lớn (Claude / Anthropic)** theo hướng *grounding ngữ cảnh* — **không huấn luyện (train) mô hình trên một tập dữ liệu**. Vì vậy "dataset" của đồ án gồm hai nhóm: (1) **dữ liệu vận hành thực sự** mà hệ thống dùng trực tiếp, và (2) **dữ liệu tham khảo** cho miền bài toán.

---

## 1. Dữ liệu vận hành (hệ thống dùng trực tiếp)

### 1.1. `exam_fees.csv` — Biểu phí khám theo chuyên khoa
Bảng giá module tính hóa đơn (`PricingService`) dùng để tính **phí khám**.

| Cột | Ý nghĩa |
|-----|---------|
| `specialty_code` | Mã chuyên khoa dùng trong hệ thống (vd `TimMach`) |
| `specialty_name_vi` | Tên hiển thị tiếng Việt |
| `exam_fee_vnd` | Phí khám (VNĐ/lượt) |

**Nguồn:** xây dựng theo khung giá dịch vụ khám chữa bệnh — Thông tư **21/2023/TT-BYT** và **22/2023/TT-BYT** (Bộ Y tế).

### 1.2. `drug_prices.csv` — Bảng giá thuốc bán lẻ (tham chiếu)
Đơn giá thuốc để ước tính **tiền thuốc** trong hóa đơn. Hệ thống khớp tên thuốc theo từ khóa (ưu tiên từ khóa dài nhất, ví dụ `amoxicillin-clavulanate` trước `amoxicillin`); số lượng = số ngày × số lần uống/ngày (mặc định 2).

| Cột | Ý nghĩa |
|-----|---------|
| `drug_keyword` | Từ khóa tên hoạt chất |
| `unit_price_vnd` | Đơn giá (VNĐ/đơn vị) |
| `unit` | Đơn vị tính (viên/lọ) |

**Nguồn:** giá thuốc bán lẻ phổ biến tại nhà thuốc Việt Nam (2024).

### 1.3. Dữ liệu demo bác sĩ – bệnh nhân – lịch khám – hồ sơ bệnh án
Dữ liệu nghiệp vụ (bảng `Doctors`, `Patients`, `Appointments`, `MedicalRecords`, `ChatMessages`) được **tự động khởi tạo (seed)** khi chạy ứng dụng lần đầu (xem `Program.cs`). Bao gồm:
- 1 tài khoản quản trị, **5 bác sĩ** (mỗi chuyên khoa), bệnh nhân mẫu;
- lịch hẹn, hồ sơ bệnh án và đơn thuốc mẫu **tổng hợp (synthetic)**.

> Đây là dữ liệu **giả lập, không chứa thông tin cá nhân thật**, dùng để minh họa và chấm thử. Cách tái tạo: tải mã nguồn → chạy ứng dụng → hệ thống tự seed.

---

## 2. Dữ liệu tham khảo

### 2.1. `insurance.csv` — Medical Cost Personal Dataset (Kaggle)
Bộ dữ liệu công khai về **chi phí y tế cá nhân** (1.338 bản ghi).

| Cột | Ý nghĩa |
|-----|---------|
| `age` | Tuổi |
| `sex` | Giới tính |
| `bmi` | Chỉ số khối cơ thể |
| `children` | Số người phụ thuộc |
| `smoker` | Có hút thuốc hay không |
| `region` | Vùng |
| `charges` | Chi phí y tế (USD) |

**Nguồn:** Kaggle — *Medical Cost Personal Datasets* (https://www.kaggle.com/datasets/mirichoi0218/insurance).

**Vai trò trong đồ án:** dữ liệu **tham khảo** cho miền bài toán chi phí khám-chữa bệnh; **không** phải dữ liệu lõi và **không** được dùng để huấn luyện mô hình (hệ thống dùng LLM). Đưa vào nhằm minh họa khía cạnh phân tích chi phí của bài toán hỗ trợ ra quyết định.

---

## Tóm tắt file
| File | Loại | Số bản ghi |
|------|------|-----------|
| `exam_fees.csv` | Vận hành | 6 |
| `drug_prices.csv` | Vận hành | 24 |
| `insurance.csv` | Tham khảo (Kaggle) | 1.338 |

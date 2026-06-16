namespace QuanLyPhongKham.Models
{
    public class ChatMessage
    {
        public int      Id           { get; set; }
        public int      PatientId    { get; set; }
        public string   Content      { get; set; } = "";
        public bool     IsAiResponse { get; set; } = false;
        public DateTime CreatedAt    { get; set; } = DateTime.Now;

        // Navigation
        public Account? Patient { get; set; }
    }
}

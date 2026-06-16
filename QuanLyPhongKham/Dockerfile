# ── Build stage ──
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . ./
RUN dotnet publish -c Release -o /app /p:UseAppHost=false

# ── Runtime stage ──
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
# Thư mục log (Serilog ghi vào /app/logs)
RUN mkdir -p /app/logs
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
ENTRYPOINT ["dotnet", "QuanLyPhongKham.dll"]

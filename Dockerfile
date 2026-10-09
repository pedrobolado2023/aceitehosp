FROM python:3.12-slim

WORKDIR /app

# Variável de ambiente para porta (compatível com Easypanel / Cloud)
ENV PORT=8080
ENV PYTHONUNBUFFERED=1

# Copiar arquivos do projeto
COPY . /app

# Expor a porta da aplicação
EXPOSE 8080

# Iniciar servidor
CMD ["python", "server.py"]

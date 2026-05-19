# Medigest | Enterprise Health Management System

![Status](https://img.shields.io/badge/Status-Active-success)
![Role](https://img.shields.io/badge/Role-Fullstack-blue)
![Stack](https://img.shields.io/badge/Stack-Python%20%7C%20JavaScript-orange)

A comprehensive healthcare management system designed to optimize clinical workflows, patient administration, and secure medical data handling.

Built with a focus on scalability, performance, and an intuitive user experience for healthcare and administrative environments.

---

## API Specifications

| Resource | Method | Technical Action |
| :--- | :---: | :--- |
| **Patients** | `GET` | Indexed retrieval of patient records |
| **Appointments** | `POST` | Appointment registration with availability validation |
| **Medical Records** | `PUT` | Updates with referential integrity enforcement |

---

## Deployment in 3 Steps

### Backend

Run:

```bash
python main.py
```

Starts the service and enables the REST API.

### Frontend

Open:

```bash
index.html
```

to access the user interface.

### Configuration

Create and configure:

```env
.env
```

Required environment variables:

```env
DATABASE_URL=your_database
SECRET_KEY=your_secret_key
```

---

# Technical Ecosystem

## Backend: Data Engine (Python)

Designed for reliability and secure clinical data management.

### Core Logic (`main.py`)
RESTful API is responsible for handling client requests and server responses.

### Data Integrity (`models.py`)
Entity modeling and business rule validation.

### Database Layer (`database.py`)
Persistence layer with optimized SQL query management.

---

## Frontend: User Interface (JS / HTML / CSS)

Built to provide a clean and efficient experience for healthcare staff.

### Reactivity
`app.js` manages asynchronous communication using `fetch`.

### Design
Modular interface adapted to healthcare workflow requirements.

---

## Project Structure

```text
📦 medigest-project
┣ 📂 backend
┃ ┣ 📜 main.py
┃ ┣ 📜 models.py
┃ ┗ 📜 database.py
┣ 📂 frontend
┃ ┣ 📜 index.html
┃ ┗ 📜 app.js
┗ 📜 .env.example
```

---

##About the Author

**Maricela Belén Milde**  
Systems Analyst | Full-stack Developer

Portfolio: https://belenmm1.github.io/Belenmm1/

---

## Project Goals

- Efficient patient management
- Appointment administration
- Digital medical records
- Data integrity and security
- Scalable architecture
- User-centered design

---

Developed with a focus on clean architecture, maintainability, and scalability.
